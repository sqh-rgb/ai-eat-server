const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

async function withAuthServer(work) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/v1/verify') {
      return res.end(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'bearer',
        expires_at: 123, expires_in: 3600,
        user: { id: 'user-1', email: 'student@example.com', email_confirmed_at: 'now', created_at: 'before' },
      }));
    }
    if (req.url === '/auth/v1/resend') return res.end(JSON.stringify({}));
    res.statusCode = 404;
    return res.end(JSON.stringify({ message: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await work(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function freshAuthService() {
  delete require.cache[require.resolve('../src/services/supabaseAuth')];
  return require('../src/services/supabaseAuth');
}

test('邮箱确认将六码一次性验证码交给 Supabase 并返回安全会话', async () => {
  await withAuthServer(async (url, requests) => {
    const before = {
      AI_EAT_SKIP_LOCAL_ENV: process.env.AI_EAT_SKIP_LOCAL_ENV,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    };
    process.env.AI_EAT_SKIP_LOCAL_ENV = 'true';
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
    try {
      const { confirmEmailOtp } = freshAuthService();
      const result = await confirmEmailOtp({ email: 'student@example.com', code: '123456' });
      assert.deepEqual(result.user, {
        id: 'user-1', email: 'student@example.com', emailConfirmedAt: 'now', createdAt: 'before',
      });
      assert.equal(result.session.accessToken, 'access-token');
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/auth/v1/verify');
      assert.equal(requests[0].body.email, 'student@example.com');
      assert.equal(requests[0].body.token, '123456');
      assert.equal(requests[0].body.type, 'email');
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      delete require.cache[require.resolve('../src/services/supabaseAuth')];
    }
  });
});

test('重新发送确认码请求 signup 模板', async () => {
  await withAuthServer(async (url, requests) => {
    const before = {
      AI_EAT_SKIP_LOCAL_ENV: process.env.AI_EAT_SKIP_LOCAL_ENV,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    };
    process.env.AI_EAT_SKIP_LOCAL_ENV = 'true';
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
    try {
      const { resendSignupConfirmation } = freshAuthService();
      await resendSignupConfirmation('student@example.com');
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/auth/v1/resend');
      assert.equal(requests[0].body.email, 'student@example.com');
      assert.equal(requests[0].body.type, 'signup');
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      delete require.cache[require.resolve('../src/services/supabaseAuth')];
    }
  });
});
