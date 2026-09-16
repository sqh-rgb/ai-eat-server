const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Supabase Data API 对用户数据和审核数据默认启用 RLS 且不授予直连策略', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations',
    '011_data_api_lockdown.postgres.sql'), 'utf8');
  for (const table of ['user_preferences', 'user_favorites', 'consumption_records',
    'user_review_submissions', 'user_ratings', 'review_risk_events', 'moderation_actions']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
});
