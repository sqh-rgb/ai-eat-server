/**
 * AI Eat — 后端服务入口（Vercel Serverless 兼容版）
 *
 * Express · RESTful API · Base: /api/v1
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const internalRoutes = require('./routes/internal');
const { databaseConfigured, query } = require('./db/pool');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ---- 中间件 ----
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    const production = process.env.NODE_ENV === 'production';
    if (!origin || allowedOrigins.includes(origin) || (!production && allowedOrigins.length === 0)) return callback(null, true);
    const error = new Error('当前网页来源不在允许列表中');
    error.code = 'ORIGIN_NOT_ALLOWED';
    return callback(error);
  },
}));
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---- 路由 ----

// 根路径：欢迎页
app.get('/', (_req, res) => {
  res.json({
    name: 'AI Eat Server',
    status: 'running',
    health: '/health',
    api: '/api/v1/discover',
  });
});

// 健康检查
app.get('/health', async (_req, res) => {
  if (!databaseConfigured()) return res.json({ status: 'ok', database: 'not-configured' });
  try {
    await query('SELECT 1');
    return res.json({ status: 'ok', database: 'ok' });
  } catch (error) {
    console.error('[Health] Database:', error.message);
    return res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

// 业务路由
app.use('/api/v1', apiRoutes);
app.use('/api/internal', internalRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

// 错误处理
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
  if (err.code === 'DATABASE_NOT_CONFIGURED') {
    return res.status(503).json({ error: { code: err.code, message: '真实数据服务尚未配置数据库' } });
  }
  if (err.code === 'ORIGIN_NOT_ALLOWED') {
    return res.status(403).json({ error: { code: err.code, message: err.message } });
  }
  if (err.code === 'AUTH_NOT_CONFIGURED') {
    return res.status(503).json({ error: { code: err.code, message: err.message } });
  }
  if (err.code === 'IDENTITY_HASH_NOT_CONFIGURED') {
    return res.status(503).json({ error: { code: err.code, message: err.message } });
  }
  if (err.status === 409) {
    return res.status(409).json({ error: { code: err.code || 'CONFLICT', message: err.message } });
  }
  if ([401, 403, 429].includes(err.status)) {
    return res.status(err.status).json({ error: { code: err.code || 'AUTH_ERROR', message: err.message } });
  }
  if (err.status === 400 || err.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
});

// ---- 启动方式：本地开发用 listen，Vercel 用 export ----

// 判断是否在 Vercel 环境（Vercel 会设置 VERCEL 环境变量）
if (!process.env.VERCEL) {
  // 本地开发模式：启动 HTTP 服务器
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  🍽  AI Eat Server (Local)');
    console.log(`  → http://localhost:${PORT}`);
    console.log(`  → API: /api/v1`);
  });
} else {
  // Vercel Serverless 模式：导出 app，Vercel 自动托管
  console.log('  🍽  AI Eat Server (Vercel)');
}

// Vercel 需要 export 整个 app
module.exports = app;
