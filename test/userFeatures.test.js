const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');
const { hashIdentity } = require('../src/services/identityHash');
const { moderateReviewSubmission } = require('../src/services/reviewModeration');
const { createReviewSubmission } = require('../src/repositories/userRepository');
const { textArray, boundedNumber, pagination } = require('../src/routes/user');
const { stripPgMemUnsupportedRls } = require('./helpers/pgMemMigrations');

async function memoryClient() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: value => String(value).length });
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: value => String(value).trim() });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.sql') && !name.endsWith('.postgres.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    await pool.query(stripPgMemUnsupportedRls(sql));
  }
  return { pool, client: await pool.connect() };
}

function transactionDatabase(client) {
  return {
    async withTransaction(work) {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
}

async function seedReviewTarget(client) {
  await client.query("INSERT INTO merchants(id,canonical_name,review_status) VALUES('media-merchant','图片店','approved')");
  await client.query("INSERT INTO branches(id,merchant_id,name,review_status,student_suitable,existence_status) VALUES('media-branch','media-merchant','图片店','approved',TRUE,'confirmed')");
}

async function seedUploadIntent(client, { id, userId = 'user-1', status = 'uploaded' }) {
  await client.query(`INSERT INTO user_upload_intents(
    id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,
    actual_mime_type,actual_byte_size,status,expires_at,confirmed_at
  ) VALUES($1,$2,'subject-1',$3,'review_photo','image/png',8,'image/png',8,$4,NOW()+INTERVAL '1 hour',NOW())`,
  [id, userId, `${userId}/${id}.png`, status]);
}

function reviewInput(uploadIntentId, rightsConfirmed = true) {
  return {
    branchId: 'media-branch', publicText: '图片真实，味道不错', rating: 5,
    media: [{ uploadIntentId, rightsConfirmed }],
  };
}

async function submitWith(client, uploadIntentId, overrides = {}) {
  return createReviewSubmission({
    userId: overrides.userId || 'user-1',
    userSubjectHash: overrides.userSubjectHash || 'subject-1',
    networkValue: '127.0.0.1', deviceValue: 'device-1',
    input: reviewInput(uploadIntentId, overrides.rightsConfirmed ?? true),
  }, { database: transactionDatabase(client) });
}

test('身份哈希稳定且不同用途不能相互关联', () => {
  assert.equal(hashIdentity('user-1', 'user'), hashIdentity('user-1', 'user'));
  assert.notEqual(hashIdentity('user-1', 'user'), hashIdentity('user-1', 'device'));
});

test('用户偏好和分页输入具有明确边界', () => {
  assert.deepEqual(textArray(['川菜', '川菜', '面食'], 'tastes'), ['川菜', '面食']);
  assert.equal(boundedNumber('30', 'budget', 0, 100), 30);
  assert.deepEqual(pagination({ limit: '10', offset: '2' }), { limit: 10, offset: 2 });
  assert.throws(() => pagination({ limit: '1.5' }), /整数/);
});

test('人工批准低风险投稿后才生成公开评论和评分', async () => {
  const { pool, client } = await memoryClient();
  try {
    await client.query("INSERT INTO merchants(id,canonical_name,review_status) VALUES('m1','学生小店','approved')");
    await client.query("INSERT INTO branches(id,merchant_id,name,review_status,student_suitable,existence_status) VALUES('b1','m1','学生小店','approved',TRUE,'confirmed')");
    await client.query(`INSERT INTO user_review_submissions(
      id,branch_id,user_subject_hash,public_text,rating,status,risk_status,risk_score
    ) VALUES('s1','b1','subject-1','价格合适，味道不错',5,'pending','allow',0)`);
    assert.deepEqual(await moderateReviewSubmission(client, {
      submissionId: 's1', decision: 'approved', reason: '内容真实', actorLabel: 'test-reviewer',
    }), { submissionId: 's1', status: 'approved' });
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM reviews WHERE status='published'")).rows[0].count, 1);
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM user_ratings WHERE status='approved'")).rows[0].count, 1);
  } finally { client.release(); await pool.end(); }
});

test('人工审核层仍禁止商家批准自己的评价', async () => {
  const { pool, client } = await memoryClient();
  try {
    await client.query("INSERT INTO merchants(id,canonical_name,review_status) VALUES('m2','二号店','approved')");
    await client.query("INSERT INTO branches(id,merchant_id,name,review_status,student_suitable,existence_status) VALUES('b2','m2','二号店','approved',TRUE,'confirmed')");
    await client.query("INSERT INTO merchant_branch_memberships(id,user_subject_hash,branch_id,status) VALUES('member-1','merchant-subject','b2','verified')");
    await client.query(`INSERT INTO user_review_submissions(
      id,branch_id,user_subject_hash,public_text,rating,status,risk_status,risk_score
    ) VALUES('s2','b2','merchant-subject','自家店最好吃',5,'pending','manual_review',50)`);
    await assert.rejects(moderateReviewSubmission(client, {
      submissionId: 's2', decision: 'approved', reason: '测试',
    }), /不得批准为自家门店评价/);
  } finally { client.release(); await pool.end(); }
});

test('评价事务拒绝附加其他用户的上传意图并回滚投稿', async () => {
  const { pool, client } = await memoryClient();
  try {
    await seedReviewTarget(client);
    await seedUploadIntent(client, { id: 'cross-user', userId: 'user-2' });
    await assert.rejects(submitWith(client, 'cross-user'), error => error.code === 'UPLOAD_NOT_ATTACHABLE');
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM user_review_submissions')).rows[0].count, 0);
  } finally { client.release(); await pool.end(); }
});

test('评价事务拒绝尚未确认完成的上传意图并回滚投稿', async () => {
  const { pool, client } = await memoryClient();
  try {
    await seedReviewTarget(client);
    await seedUploadIntent(client, { id: 'not-confirmed', status: 'issued' });
    await assert.rejects(submitWith(client, 'not-confirmed'), error => error.code === 'UPLOAD_NOT_ATTACHABLE');
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM user_review_submissions')).rows[0].count, 0);
  } finally { client.release(); await pool.end(); }
});

test('评价媒体必须明确确认图片权利', async () => {
  const { pool, client } = await memoryClient();
  try {
    await seedReviewTarget(client);
    await seedUploadIntent(client, { id: 'rights-not-confirmed' });
    await assert.rejects(submitWith(client, 'rights-not-confirmed', { rightsConfirmed: false }), /确认拥有图片权利/);
    assert.equal((await client.query("SELECT status FROM user_upload_intents WHERE id='rights-not-confirmed'")).rows[0].status, 'uploaded');
  } finally { client.release(); await pool.end(); }
});

test('同一上传意图只能附加到一条评价', async () => {
  const { pool, client } = await memoryClient();
  try {
    await seedReviewTarget(client);
    await seedUploadIntent(client, { id: 'single-attach' });
    await submitWith(client, 'single-attach');
    await assert.rejects(submitWith(client, 'single-attach'), error => error.code === 'UPLOAD_NOT_ATTACHABLE');
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM user_submission_media WHERE upload_intent_id='single-attach'")).rows[0].count, 1);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM user_review_submissions')).rows[0].count, 1);
  } finally { client.release(); await pool.end(); }
});

test('合法上传意图在评价事务内原子附加且媒体元数据只取自服务端', async () => {
  const { pool, client } = await memoryClient();
  try {
    await seedReviewTarget(client);
    await seedUploadIntent(client, { id: 'atomic-attach' });
    const submission = await submitWith(client, 'atomic-attach');
    const intent = (await client.query("SELECT status,attached_submission_id FROM user_upload_intents WHERE id='atomic-attach'")).rows[0];
    const media = (await client.query("SELECT upload_intent_id,storage_key,mime_type,byte_size,rights_confirmed FROM user_submission_media WHERE upload_intent_id='atomic-attach'")).rows[0];
    assert.equal(intent.status, 'attached');
    assert.equal(intent.attached_submission_id, submission.id);
    assert.deepEqual(media, {
      upload_intent_id: 'atomic-attach', storage_key: 'user-1/atomic-attach.png',
      mime_type: 'image/png', byte_size: 8, rights_confirmed: true,
    });
  } finally { client.release(); await pool.end(); }
});
