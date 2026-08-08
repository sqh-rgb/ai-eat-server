/**
 * 认证中间件 — 解析 Supabase JWT，提取 user_id
 *
 * 当前阶段：不强制要求 JWT。
 *   - 本地开发：无 Token → dev-default-user
 *   - 生产环境：无 Token → anonymous（游客模式）
 *
 * 后续接入 Supabase Auth 后，将 anonymous 替换为真实 JWT 验证。
 */

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // 当前阶段：允许游客访问（后续接入 Supabase 后改为 401）
    req.userId = 'anonymous';
    return next();
  }

  const token = authHeader.split(' ')[1];

  // TODO: 接入 Supabase Auth 后替换为 supabase.auth.getUser(token)
  req.userId = 'authenticated-user';
  next();
}

/** 简单的限流计数器（60 req/min 每用户） */
const rateMap = new Map();

function rateLimiter(req, res, next) {
  const key = req.userId || req.ip;
  const now = Date.now();
  const window = 60000;

  if (!rateMap.has(key)) {
    rateMap.set(key, []);
  }

  const timestamps = rateMap.get(key).filter(t => now - t < window);
  timestamps.push(now);
  rateMap.set(key, timestamps);

  if (timestamps.length > 60) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试' } });
  }

  next();
}

// 定期清理过期计时器（避免内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateMap) {
    const fresh = timestamps.filter(t => now - t < 60000);
    if (fresh.length === 0) {
      rateMap.delete(key);
    } else {
      rateMap.set(key, fresh);
    }
  }
}, 120000); // 每 2 分钟清理

module.exports = { authMiddleware, rateLimiter };
