const { Router } = require('express');
const { authMiddleware, rateLimiter } = require('../middleware/auth');
const { searchNearby } = require('../services/amapService');
const { scoreAll, rankAndFilter } = require('../services/scoringEngine');
const { generateReasons } = require('../services/reasonEngine');
const { get: cacheGet, set: cacheSet, makeKey } = require('../services/cacheService');

const router = Router();

// 全部业务路由都过认证和限流
router.use(authMiddleware);
router.use(rateLimiter);

/**
 * POST /api/v1/recommend — 核心推荐接口
 */
router.post('/recommend', async (req, res) => {
  try {
    const { lat, lng, budget = 30, radius = 1000, taste = 'any', people = 1 } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少经纬度参数' } });
    }

    // 1. 查缓存
    const cacheKey = makeKey(lat, lng, budget, radius, taste);
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    // 2. 调高德 API（带扩大半径重试）
    let candidates = [];
    let searchRadius = radius;
    let attempts = 0;

    while (attempts < 4) {
      candidates = await searchNearby(lat, lng, searchRadius);
      if (candidates.length >= 5) break;
      searchRadius = Math.min(searchRadius * 1.5, 5000);
      attempts++;
    }

    // 3. 处理高德 API 空结果
    if (candidates.length === 0) {
      return res.json({ results: [], cached: false, notice: '附近暂无符合条件的餐厅，试试扩大搜索范围' });
    }

    // 4. 评分引擎打分
    const scored = scoreAll(candidates, { budget, taste });

    // 5. 排序 + 取 Top 5
    let ranked = rankAndFilter(scored, { topN: 5, minScore: 3 });

    // 6. 结果不足 3 家 → 放宽条件
    if (ranked.length < 3) {
      const relaxed = scoreAll(candidates, { budget, taste: 'any' }); // 忽略口味过滤
      ranked = rankAndFilter(relaxed, { topN: 5, minScore: 2 });
    }

    // 7. 仍然不足 → 按距离排序返回最近几家
    if (ranked.length === 0) {
      ranked = candidates
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
        .map(r => ({ ...r, score: 1, dimensions: { D: 1, P: 1, T: 5, R: 3, E: 0 } }));
    }

    // 8. 生成推荐理由
    const withReasons = generateReasons(ranked, { budget });

    // 9. 写入缓存
    cacheSet(cacheKey, withReasons);

    // 10. 返回
    res.json({
      results: withReasons,
      cached: false,
      total: candidates.length,
      notice: ranked.length < 3 ? '附近符合条件的餐厅不多，已为你找到所有匹配结果' : undefined
    });

  } catch (err) {
    console.error('[Recommend] Error:', err.message);

    // API 超时/异常 → 兜底
    if (err.cause?.code === 'ETIMEDOUT' || err.name === 'AbortError') {
      return res.status(503).json({ error: { code: 'AMAP_TIMEOUT', message: '地图服务暂时不可用，请稍后重试' } });
    }

    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务内部错误' } });
  }
});

/**
 * GET /api/v1/restaurant/:id — 餐厅详情（简化版，返回缓存数据）
 */
router.get('/restaurant/:id', (req, res) => {
  // 实际部署时查 restaurants 表
  res.json({ message: '详情查询接口 — 需 Supabase 接入' });
});

/**
 * POST / GET / DELETE /api/v1/favorites — 收藏 CRUD
 */
router.post('/favorites', (req, res) => {
  res.json({ ok: true, message: '收藏接口 — 需 Supabase 接入' });
});

router.get('/favorites', (req, res) => {
  res.json({ favorites: [] });
});

router.delete('/favorites/:id', (req, res) => {
  res.json({ ok: true, message: '已取消收藏' });
});

/**
 * POST /api/v1/rating — 用户评分
 */
router.post('/rating', (req, res) => {
  res.json({ ok: true, message: '评分接口 — 需 Supabase 接入' });
});

/**
 * POST / GET /api/v1/records — 消费记录
 */
router.post('/records', (req, res) => {
  res.json({ ok: true, message: '记录接口 — 需 Supabase 接入' });
});

router.get('/records', (req, res) => {
  res.json({ records: [], stats: {} });
});

/**
 * GET / PUT /api/v1/user/preferences — 用户偏好
 */
router.get('/user/preferences', (req, res) => {
  res.json({ taste_prefs: [], default_budget: 30, default_radius: 1000 });
});

router.put('/user/preferences', (req, res) => {
  res.json({ ok: true, message: '偏好已更新' });
});

module.exports = router;
