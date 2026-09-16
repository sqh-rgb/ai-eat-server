const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('生产数据库迁移包含商家自评的提交与评分双重触发器', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations',
    '008_merchant_self_review_trigger.postgres.sql'), 'utf8');
  assert.match(sql, /merchant_branch_memberships/);
  assert.match(sql, /trg_prevent_merchant_self_submission/);
  assert.match(sql, /trg_prevent_merchant_self_rating/);
  assert.match(sql, /NEW\.status = 'approved'/);
});
