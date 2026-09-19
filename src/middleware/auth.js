const crypto = require('node:crypto');
const { verifyAccessToken } = require('../services/supabaseAuth');
const { hashIdentity } = require('../services/identityHash');

async function authMiddleware(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader) {
    req.user = null;
    req.userId = 'anonymous';
    return next();
  }
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Authorization 格式无效' } });
  }
  try {
    req.authToken = match[1];
    req.user = await verifyAccessToken(req.authToken);
    req.userId = req.user.id;
    req.userSubjectHash = hashIdentity(req.user.id, 'user');
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user || !req.userId || req.userId === 'anonymous') {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '请先登录' } });
  }
  return next();
}

function createMemoryLimiter({ limit, windowMs, prefix }) {
  const store = new Map();
  const middleware = (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const principal = req.userId && req.userId !== 'anonymous' ? req.userId : req.ip;
    const identity = `${principal}:${email}`;
    const key = `${prefix}:${crypto.createHash('sha256').update(identity).digest('hex')}`;
    const now = Date.now();
    const timestamps = (store.get(key) || []).filter(value => now - value < windowMs);
    if (timestamps.length >= limit) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } });
    }
    timestamps.push(now);
    store.set(key, timestamps);
    return next();
  };
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of store) {
      const fresh = timestamps.filter(value => value >= cutoff);
      if (fresh.length) store.set(key, fresh); else store.delete(key);
    }
  }, Math.min(windowMs, 120000));
  timer.unref?.();
  return middleware;
}

const rateLimiter = createMemoryLimiter({ limit: 60, windowMs: 60000, prefix: 'api' });
const authRateLimiter = createMemoryLimiter({ limit: 10, windowMs: 15 * 60000, prefix: 'auth' });

module.exports = { authMiddleware, requireAuth, rateLimiter, authRateLimiter, createMemoryLimiter };
