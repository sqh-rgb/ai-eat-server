/**
 * AI Eat — 后端服务入口（Vercel Serverless 兼容版）
 *
 * Express · RESTful API · Base: /api/v1
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');

const app = express();

// ---- 中间件 ----
app.use(cors());
app.use(express.json());

// ---- 路由 ----

// 根路径：欢迎页
app.get('/', (_req, res) => {
  res.json({
    name: 'AI Eat Server',
    status: 'running',
    health: '/health',
    api: '/api/v1/recommend',
  });
});

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 业务路由
app.use('/api/v1', apiRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

// 错误处理
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
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
