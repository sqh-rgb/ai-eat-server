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

function signedStorage() {
  return {
    storage: {
      from() {
        return {
          async createSignedUploadUrl() { return { data: { signedUrl: 'https://signed.example/upload', token: 'signed-token' }, error: null }; },
          async remove() { throw new Error('用户客户端不得删除对象'); },
        };
      },
    },
  };
}

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
        const uploads = createStorageUploads({ database, getUserClient: signedStorage });
        await assert.rejects(uploads.issueUpload({
          userId: 'user-1', userSubjectHash: 'subject-1', accessToken: 'token',
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
      getUserClient: signedStorage,
      getServiceClient: () => ({ storage: { from: () => ({
        async remove(keys) {
          assert.deepEqual(keys, ['user-1/intent-delete.png']);
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
    async issueUpload() { return { id: 'intent-1' }; },
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
    assert.equal((await issued.json()).item.id, 'intent-1');
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

test('Supabase Storage 写入必须匹配未过期意图且客户端没有 DELETE 策略', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations',
    '013_private_review_storage.postgres.sql'), 'utf8');
  assert.match(sql, /SECURITY DEFINER[\s\S]+user_upload_intents[\s\S]+user_id\s*=\s*subject[\s\S]+storage_key\s*=\s*object_key[\s\S]+status\s*=\s*'issued'[\s\S]+expires_at\s*>\s*NOW\(\)/i);
  assert.match(sql, /ai_eat_review_upload_insert[\s\S]+WITH CHECK[\s\S]+auth\.uid\(\)[\s\S]+name/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY\s+ai_eat_review_upload_delete/i);
});
