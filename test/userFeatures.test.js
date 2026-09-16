const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');
const { hashIdentity } = require('../src/services/identityHash');
const { moderateReviewSubmission } = require('../src/services/reviewModeration');
const { textArray, boundedNumber, pagination } = require('../src/routes/user');

async function memoryClient() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: value => String(value).length });
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: value => String(value).trim() });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.sql') && !name.endsWith('.postgres.sql')).sort();
  for (const file of files) await pool.query(fs.readFileSync(path.join(directory, file), 'utf8'));
  return { pool, client: await pool.connect() };
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
