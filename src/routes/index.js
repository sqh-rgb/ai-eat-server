const { Router } = require('express');
const { authMiddleware, rateLimiter } = require('../middleware/auth');
const { searchNearby, geocode } = require('../services/amapService');
const { scoreAll, rankAndFilter } = require('../services/scoringEngine');
const { generateReasons } = require('../services/reasonEngine');
const { get: cacheGet, set: cacheSet, makeKey } = require('../services/cacheService');

const router = Router();

router.use(authMiddleware);
router.use(rateLimiter);

router.post('/recommend', async (req, res) => {
  try {
    const { lat, lng, budget = 30, radius = 1000, taste = 'any', people = 1 } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少经纬度参数' } });
    const cacheKey = makeKey(lat, lng, budget, radius, taste);
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ results: cached, cached: true });
    let candidates = [], searchRadius = radius, attempts = 0;
    while (attempts < 4) {
      candidates = await searchNearby(lat, lng, searchRadius);
      if (candidates.length >= 5) break;
      searchRadius = Math.min(searchRadius * 1.5, 5000); attempts++;
    }
    if (candidates.length === 0) return res.json({ results: [], cached: false, notice: '附近暂无符合条件的餐厅' });
    const scored = scoreAll(candidates, { budget, taste });
    let ranked = rankAndFilter(scored, { topN: 5, minScore: 2 });
    if (ranked.length < 3) {
      const relaxed = scoreAll(candidates, { budget, taste: 'any' });
      ranked = rankAndFilter(relaxed, { topN: 5, minScore: 1 });
    }
    if (ranked.length === 0) {
      ranked = candidates.sort((a, b) => a.distance - b.distance).slice(0, 3)
        .map(r => ({ ...r, score: 1, dimensions: { D: 1, P: 1, T: 5, R: 3, E: 0 } }));
    }
    const withReasons = generateReasons(ranked, { budget });
    cacheSet(cacheKey, withReasons);
    res.json({ results: withReasons, cached: false, total: candidates.length,
      notice: ranked.length < 3 ? '附近符合条件的餐厅不多' : undefined });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  }
});

router.get('/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: '缺少 address 参数' });
  try {
    const result = await geocode(address);
    if (!result) return res.json({ error: '未找到该地址' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '地址查询失败' });
  }
});

router.get('/restaurant/:id', (req, res) => res.json({ message: '详情查询接口' }));
router.post('/favorites', (req, res) => res.json({ ok: true }));
router.get('/favorites', (req, res) => res.json({ favorites: [] }));
router.delete('/favorites/:id', (req, res) => res.json({ ok: true }));
router.post('/rating', (req, res) => res.json({ ok: true }));
router.post('/records', (req, res) => res.json({ ok: true }));
router.get('/records', (req, res) => res.json({ records: [], stats: {} }));
router.get('/user/preferences', (req, res) => res.json({ taste_prefs: [], default_budget: 30, default_radius: 1000 }));
router.put('/user/preferences', (req, res) => res.json({ ok: true }));

module.exports = router;
