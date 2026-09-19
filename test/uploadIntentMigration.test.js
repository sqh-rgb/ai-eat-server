const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('012 在自身事务中为管理员和上传意图表启用 RLS', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations',
    '012_upload_intents_and_admins.sql'), 'utf8');

  for (const table of ['app_admins', 'user_upload_intents']) {
    assert.match(sql, new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, 'i'));
  }
});
