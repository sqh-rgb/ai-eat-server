const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { newDb, DataType } = require('pg-mem');
const {
  MAX_CONCURRENT_UPLOADS,
  MAX_DAILY_UPLOADS,
  createStorageUploads,
  validateUploadRequest,
} = require('../src/services/storageUploads');
const { createUserRouter } = require('../src/routes/user');

async function memoryDatabase() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: value => String(value).length });
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: value => String(value).trim() });
  memory.public.registerFunction({ name: 'hashtext', args: [DataType.text], returns: DataType.integer, implementation: () => 1 });
  memory.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1 });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.sql') && !name.endsWith('.postgres.sql')).sort();
  for (const file of files) await pool.query(fs.readFileSync(path.join(directory, file), 'utf8'));
  return {
    pool,
    database: {
      query: (sql, params) => pool.query(sql, params),
      async withTransaction(work) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
    },
  };
}

function userStorageThatCannotDelete() {
  return {
    storage: {
      from() {
        return {
          async remove() { throw new Error('用户客户端不得删除对象'); },
        };
      },
    },
  };
}

test('上传申请只返回受当前登录会话 RLS 约束的直传元数据', async () => {
  const { pool, database } = await memoryDatabase();
  try {
    const uploads = createStorageUploads({
      database,
      randomUUID: () => 'intent-direct',
      getUserClient() { throw new Error('申请上传意图时不应创建签名上传凭据'); },
    });
    const item = await uploads.issueUpload({
      userId: 'user-1', userSubjectHash: 'subject-1',
      input: { mimeType: 'image/png', mediaKind: 'review_photo', byteSize: 8 },
    });
    assert.deepEqual(item, {
      id: 'intent-direct', bucket: 'ai-eat-review-submissions',
      storageKey: 'user-1/intent-direct.png',
      expiresAt: item.expiresAt,
      mimeType: 'image/png', byteSize: 8, mediaKind: 'review_photo',
    });
    assert.equal(Object.hasOwn(item, 'signedUrl'), false);
    assert.equal(Object.hasOwn(item, 'token'), false);
  } finally { await pool.end(); }
});

test('上传申请拒绝非图片 MIME', () => {
  assert.throws(() => validateUploadRequest({
    mimeType: 'application/pdf', mediaKind: 'review_photo', byteSize: 100,
  }), /只允许/);
});

test('上传意图同时限制活跃任务数和 24 小时申请数', async t => {
  for (const scenario of [
    { name: '活跃任务', total: MAX_CONCURRENT_UPLOADS, status: 'uploaded' },
    { name: '24 小时申请', total: MAX_DAILY_UPLOADS, status: 'deleted' },
  ]) {
    await t.test(scenario.name, async () => {
      const { pool, database } = await memoryDatabase();
      try {
        for (let index = 0; index < scenario.total; index += 1) {
          await pool.query(`INSERT INTO user_upload_intents(
            id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,status,expires_at
          ) VALUES($1,'user-1','subject-1',$2,'review_photo','image/png',8,$3,NOW()+INTERVAL '1 hour')`,
          [`intent-${index}`, `user-1/intent-${index}.png`, scenario.status]);
        }
        const uploads = createStorageUploads({ database, getUserClient: userStorageThatCannotDelete });
        await assert.rejects(uploads.issueUpload({
          userId: 'user-1', userSubjectHash: 'subject-1',
          input: { mimeType: 'image/png', mediaKind: 'review_photo', byteSize: 8 },
        }), error => error.code === 'UPLOAD_QUOTA_EXCEEDED' && error.status === 429);
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM user_upload_intents WHERE user_id='user-1'")).rows[0].count, scenario.total);
      } finally { await pool.end(); }
    });
  }
});

test('删除未附加上传只使用服务角色客户端', async () => {
  const { pool, database } = await memoryDatabase();
  let serviceDeletes = 0;
  try {
    await pool.query(`INSERT INTO user_upload_intents(
      id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,status,expires_at
    ) VALUES('intent-delete','user-1','subject-1','user-1/intent-delete.png','review_photo','image/png',8,'uploaded',NOW()+INTERVAL '1 hour')`);
    const uploads = createStorageUploads({
      database,
      getUserClient: userStorageThatCannotDelete,
      getServiceClient: () => ({ storage: { from: () => ({
        async remove(keys) {
          assert.deepEqual(keys, ['user-1/intent-delete.png']);
          assert.equal((await pool.query("SELECT status FROM user_upload_intents WHERE id='intent-delete'")).rows[0].status, 'deleted');
          serviceDeletes += 1;
          return { error: null };
        },
      }) } }),
    });
    await uploads.deleteUpload({ userId: 'user-1', intentId: 'intent-delete' });
    assert.equal(serviceDeletes, 1);
    assert.equal((await pool.query("SELECT status FROM user_upload_intents WHERE id='intent-delete'")).rows[0].status, 'deleted');
  } finally { await pool.end(); }
});

test('缺少服务角色配置时删除安全失败', async () => {
  const { pool, database } = await memoryDatabase();
  try {
    await pool.query(`INSERT INTO user_upload_intents(
      id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,status,expires_at
    ) VALUES('intent-no-service','user-1','subject-1','user-1/intent-no-service.png','review_photo','image/png',8,'uploaded',NOW()+INTERVAL '1 hour')`);
    const uploads = createStorageUploads({
      database,
      getServiceClient() {
        const error = new Error('服务端存储凭证尚未配置');
        error.code = 'STORAGE_SERVICE_NOT_CONFIGURED';
        error.status = 503;
        throw error;
      },
    });
    await assert.rejects(uploads.deleteUpload({ userId: 'user-1', intentId: 'intent-no-service' }),
      error => error.code === 'STORAGE_SERVICE_NOT_CONFIGURED' && error.status === 503);
    assert.equal((await pool.query("SELECT status FROM user_upload_intents WHERE id='intent-no-service'")).rows[0].status, 'uploaded');
  } finally { await pool.end(); }
});

test('服务角色删除失败后保持权限撤销并允许重试对象清理', async () => {
  const { pool, database } = await memoryDatabase();
  let attempts = 0;
  try {
    await pool.query(`INSERT INTO user_upload_intents(
      id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,status,expires_at
    ) VALUES('intent-delete-retry','user-1','subject-1','user-1/intent-delete-retry.png','review_photo','image/png',8,'uploaded',NOW()+INTERVAL '1 hour')`);
    const uploads = createStorageUploads({
      database,
      getServiceClient: () => ({ storage: { from: () => ({
        async remove() {
          attempts += 1;
          return { error: attempts === 1 ? new Error('temporary storage failure') : null };
        },
      }) } }),
    });
    await assert.rejects(uploads.deleteUpload({ userId: 'user-1', intentId: 'intent-delete-retry' }),
      error => error.code === 'STORAGE_UNAVAILABLE' && error.status === 502);
    assert.equal((await pool.query("SELECT status FROM user_upload_intents WHERE id='intent-delete-retry'")).rows[0].status, 'deleted');
    await uploads.deleteUpload({ userId: 'user-1', intentId: 'intent-delete-retry' });
    assert.equal(attempts, 2);
  } finally { await pool.end(); }
});

test('确认上传的最终状态更新会拒绝下载期间刚过期的意图', async () => {
  const { pool, database } = await memoryDatabase();
  try {
    await pool.query(`INSERT INTO user_upload_intents(
      id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,status,expires_at
    ) VALUES('intent-expiry-race','user-1','subject-1','user-1/intent-expiry-race.png','review_photo','image/png',8,'issued',NOW()+INTERVAL '1 hour')`);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploads = createStorageUploads({
      database,
      getUserClient: () => ({ storage: { from: () => ({
        async download() {
          return { data: { async arrayBuffer() {
            await pool.query("UPDATE user_upload_intents SET expires_at=NOW()-INTERVAL '1 second' WHERE id='intent-expiry-race'");
            return bytes.buffer;
          } }, error: null };
        },
      }) } }),
    });
    await assert.rejects(uploads.confirmUpload({
      userId: 'user-1', accessToken: 'token', intentId: 'intent-expiry-race',
    }), error => error.code === 'UPLOAD_EXPIRED' && error.status === 409);
    assert.equal((await pool.query("SELECT status FROM user_upload_intents WHERE id='intent-expiry-race'")).rows[0].status, 'expired');
  } finally { await pool.end(); }
});

async function withServer(router, work) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    req.userId = 'user-1';
    req.userSubjectHash = 'subject-1';
    req.authToken = 'token';
    next();
  });
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
}

test('用户上传路由暴露申请、确认、预览和删除状态码', async () => {
  const uploads = {
    async issueUpload(args) {
      assert.equal(Object.hasOwn(args, 'accessToken'), false);
      return {
        id: 'intent-1', bucket: 'ai-eat-review-submissions', storageKey: 'user-1/intent-1.png',
        mimeType: 'image/png', byteSize: 8, mediaKind: 'review_photo', expiresAt: new Date().toISOString(),
      };
    },
    async confirmUpload() { return { id: 'intent-1', status: 'uploaded' }; },
    async createPreviewUrl() { return { signedUrl: 'https://signed.example/preview', expiresIn: 300 }; },
    async deleteUpload() {},
  };
  await withServer(createUserRouter({ uploads }), async base => {
    const issued = await fetch(`${base}/user/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mimeType: 'image/png', mediaKind: 'review_photo', byteSize: 8 }),
    });
    assert.equal(issued.status, 201);
    const issuedItem = (await issued.json()).item;
    assert.equal(issuedItem.id, 'intent-1');
    assert.equal(issuedItem.storageKey, 'user-1/intent-1.png');
    assert.equal(Object.hasOwn(issuedItem, 'signedUrl'), false);
    assert.equal(Object.hasOwn(issuedItem, 'token'), false);
    const confirmed = await fetch(`${base}/user/uploads/intent-1/confirm`, { method: 'POST' });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).item.status, 'uploaded');
    const preview = await fetch(`${base}/user/uploads/intent-1/preview`);
    assert.equal(preview.status, 200);
    assert.match((await preview.json()).item.signedUrl, /^https:\/\//);
    const removed = await fetch(`${base}/user/uploads/intent-1`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
  });
});

test('Supabase Storage 权限函数内部绑定 auth.uid 且使用安全 search_path', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations',
    '013_private_review_storage.postgres.sql'), 'utf8');
  assert.match(sql, /REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i);
  assert.match(sql, /FUNCTION\s+public\.is_ai_eat_admin\(\s*\)/i);
  assert.match(sql, /FUNCTION\s+public\.has_valid_ai_eat_upload_intent\(\s*object_key\s+TEXT\s*,\s*object_bucket\s+TEXT\s*\)/i);
  assert.doesNotMatch(sql, /FUNCTION\s+public\.(?:is_ai_eat_admin|has_valid_ai_eat_upload_intent)\([^)]*subject/i);
  const securityDefiners = [...sql.matchAll(/SECURITY DEFINER([\s\S]*?)\$\$;/gi)];
  assert.equal(securityDefiners.length, 2);
  for (const definition of securityDefiners) assert.match(definition[0], /SET\s+search_path\s*=\s*''/i);
  assert.match(sql, /public\.app_admins[\s\S]+user_id\s*=\s*\(SELECT auth\.uid\(\)::text\)/i);
  assert.match(sql, /public\.user_upload_intents[\s\S]+user_id\s*=\s*\(SELECT auth\.uid\(\)::text\)[\s\S]+storage_key\s*=\s*object_key[\s\S]+status\s*=\s*'issued'[\s\S]+expires_at\s*>\s*pg_catalog\.now\(\)/i);
  assert.match(sql, /ai_eat_review_upload_insert[\s\S]+public\.has_valid_ai_eat_upload_intent\(\s*name\s*,\s*bucket_id\s*\)/i);
  assert.match(sql, /public\.is_ai_eat_admin\(\s*\)/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY\s+ai_eat_review_upload_delete/i);
});
