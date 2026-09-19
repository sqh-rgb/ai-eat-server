const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VERCEL = '1';
process.env.AI_EAT_SKIP_LOCAL_ENV = 'true';
delete process.env.DATABASE_URL;
const app = require('../src/index');

async function withServer(work) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

test('健康检查明确报告数据库尚未配置', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'not-configured' });
  });
});

test('真实数据接口没有数据库时返回 503', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/dishes`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'DATABASE_NOT_CONFIGURED');
  });
});

test('需要登录的旧写接口会先拒绝游客', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/favorites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
  });
});

test('推荐接口在访问数据库前拒绝异常坐标和筛选条件', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 200, lng: 106, spiceLevels: [8] }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  });
});

test('半月评分定时入口在未配置密钥时拒绝执行', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/internal/ratings/aggregate`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'CRON_NOT_CONFIGURED');
  });
});

test('旧版实时地图推荐不能绕过商家核实保护层', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/recommend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 29.8, lng: 106.4 }),
    });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, 'ENDPOINT_RETIRED');
  });
});

test('邮箱认证参数先本地校验且未登录不能读取当前用户', async () => {
  await withServer(async base => {
    const invalid = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad', password: 'short' }),
    });
    assert.equal(invalid.status, 400);
    const me = await fetch(`${base}/api/v1/auth/me`);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).error.code, 'AUTH_REQUIRED');
  });
});

test('邮箱确认接口会在访问认证服务前拒绝格式错误的验证码', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/auth/confirm-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@example.com', code: 'wrong' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  });
});

test('配置缺失时认证接口明确返回 503 而不是伪登录', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@example.com', password: 'Abcdef12!' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED');
  });
});
