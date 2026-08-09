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

    // 人均预算
    const perPerson = people > 0 ? Math.round(budget / people) : budget;

    const cacheKey = makeKey(lat, lng, perPerson, radius, taste);
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ results: cached, cached: true });

    // 扩大搜索：一次搜 50 家
    let candidates = [], sr = radius, attempts = 0;
    while (attempts < 4) {
      candidates = await searchNearby(lat, lng, sr, 50);
      if (candidates.length >= 10) break;
      sr = Math.min(sr * 1.5, 5000); attempts++;
    }

    if (candidates.length === 0) return res.json({ results: [], cached: false, notice: '附近暂无符合条件的餐厅' });

    // 用人均预算评分
    const scored = scoreAll(candidates, { budget: perPerson, taste });
    let ranked = rankAndFilter(scored, { topN: 10, minScore: 2 });

    if (ranked.length < 5) {
      const relaxed = scoreAll(candidates, { budget: perPerson, taste: 'any' });
      ranked = rankAndFilter(relaxed, { topN: 10, minScore: 1 });
    }

    if (ranked.length === 0) {
      ranked = candidates.sort((a, b) => (b.rating || 3) - (a.rating || 3)).slice(0, 5)
        .map(r => ({ ...r, score: 1, dimensions: { D: 1, P: 1, T: 5, R: (r.rating || 3) * 2, E: 0 } }));
    }

    const withReasons = generateReasons(ranked, { budget: perPerson });
    cacheSet(cacheKey, withReasons);
    res.json({ results: withReasons, cached: false, total: candidates.length });
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
  } catch (err) { res.status(500).json({ error: '地址查询失败' }); }
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
