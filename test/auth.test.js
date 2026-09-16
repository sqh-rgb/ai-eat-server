const test = require('node:test');
const assert = require('node:assert/strict');
const { emailValue, passwordValue } = require('../src/routes/auth');
const { safeUser, normalizeAuthError } = require('../src/services/supabaseAuth');

test('邮箱登录参数会规范化邮箱但不会改写密码', () => {
  assert.equal(emailValue(' Student@Example.COM '), 'student@example.com');
  assert.equal(passwordValue('Abcdef12!'), 'Abcdef12!');
});

test('拒绝无效邮箱、短密码和控制字符', () => {
  assert.throws(() => emailValue('not-an-email'), /有效的邮箱/);
  assert.throws(() => passwordValue('short'), /8～72/);
  assert.throws(() => passwordValue('abcdefgh\n'), /控制字符/);
});

test('公开用户对象不泄露 Supabase 内部元数据', () => {
  assert.deepEqual(safeUser({
    id: 'user-1', email: 'a@example.com', email_confirmed_at: 'now', created_at: 'before',
    app_metadata: { provider: 'email' }, user_metadata: { secret: 'hidden' },
  }), { id: 'user-1', email: 'a@example.com', emailConfirmedAt: 'now', createdAt: 'before' });
});

test('登录失败统一为不暴露账户存在性的错误', () => {
  const error = normalizeAuthError({ status: 400, message: 'Invalid login credentials' });
  assert.equal(error.code, 'INVALID_CREDENTIALS');
  assert.equal(error.status, 401);
  assert.equal(error.message, '邮箱或密码不正确');
});
