const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '..', 'scripts', 'configure-local-auth.js');

function runConfigurator(environmentFile, publishableKey, secretKey) {
  return spawnSync(
    process.execPath,
    [script],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        AI_EAT_AUTH_ENV_FILE: environmentFile,
        AI_EAT_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        AI_EAT_SUPABASE_SECRET_KEY: secretKey,
      },
    },
  );
}

test('本地认证配置会隐藏密钥并写入固定的测试项目设置', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eat-auth-'));
  const environmentFile = path.join(directory, '.env.auth.local');
  const publishableKey = 'sb_publishable_test_1234567890';
  const secretKey = 'sb_secret_test_1234567890';

  try {
    const result = runConfigurator(environmentFile, publishableKey, secretKey);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      fs.readFileSync(environmentFile, 'utf8'),
      [
        'SUPABASE_URL="https://trjctzubbppgblnjlycs.supabase.co"',
        `SUPABASE_PUBLISHABLE_KEY="${publishableKey}"`,
        `SUPABASE_SERVICE_ROLE_KEY="${secretKey}"`,
        'AUTH_EMAIL_REDIRECT_URL="http://localhost:5173/auth/callback"',
        'AUTH_PASSWORD_RESET_REDIRECT_URL="http://localhost:5173/auth/reset-password"',
        '',
      ].join('\n'),
    );
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sb_(?:publishable|secret)_test/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('本地认证配置拒绝错误类型的密钥且不创建文件', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eat-auth-'));
  const environmentFile = path.join(directory, '.env.auth.local');

  try {
    const result = runConfigurator(environmentFile, 'sb_secret_wrong_type_1234567890', 'sb_secret_test_1234567890');

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Publishable key must start with sb_publishable_/,
    );
    assert.equal(fs.existsSync(environmentFile), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
