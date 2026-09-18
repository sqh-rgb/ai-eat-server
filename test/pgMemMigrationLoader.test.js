const test = require('node:test');
const assert = require('node:assert/strict');
const { stripPgMemUnsupportedRls } = require('./helpers/pgMemMigrations');

test('pg-mem 迁移适配仅剥离两张目标表的 ENABLE RLS 语句', () => {
  const sql = [
    'BEGIN;',
    'ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE keep_protected ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE user_upload_intents DISABLE ROW LEVEL SECURITY;',
    'ALTER TABLE user_upload_intents ENABLE ROW LEVEL SECURITY;',
    "SELECT 'ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;' AS statement_text;",
    'COMMIT;',
  ].join('\n');

  assert.equal(stripPgMemUnsupportedRls(sql), [
    'BEGIN;',
    'ALTER TABLE keep_protected ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE user_upload_intents DISABLE ROW LEVEL SECURITY;',
    "SELECT 'ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;' AS statement_text;",
    'COMMIT;',
  ].join('\n'));
});
