const { Router } = require('express');
const { authMiddleware, requireAuth, rateLimiter } = require('../middleware/auth');
const catalogRoutes = require('./catalog');
const authRoutes = require('./auth');
const userRoutes = require('./user');

const router = Router();

// 全部业务路由都过认证和限流
router.use(authMiddleware);
router.use(rateLimiter);

router.use('/auth', authRoutes.router);
router.use(userRoutes.router);

// 公开目录、邮箱认证及登录后的用户数据接口。
router.use(catalogRoutes);

/**
 * POST /api/v1/recommend — 核心推荐接口
 */
router.post('/recommend', (_req, res) => {
  res.status(410).json({
    error: {
      code: 'ENDPOINT_RETIRED',
      message: '旧版实时地图推荐已停用，请改用只返回已审核且已确认营业商家的 /api/v1/discover',
    },
  });
});

/**
 * GET /api/v1/restaurant/:id — 餐厅详情（简化版，返回缓存数据）
 */
router.get('/restaurant/:id', (_req, res) => {
  res.status(410).json({
    error: { code: 'ENDPOINT_RETIRED', message: '请改用 /api/v1/restaurants/:id' },
  });
});

/**
 * POST /api/v1/rating — 用户评分
 */
router.post('/rating', requireAuth, (req, res) => {
  res.status(501).json({ error: { code: 'AUTH_DEFERRED', message: '评分功能将在用户登录机制完成后开放' } });
});

module.exports = router;
