const { Router } = require('express');
const catalog = require('../repositories/catalogRepository');
const { recommendHybrid } = require('../services/hybridRecommendationEngine');

const router = Router();

function numberQuery(value, fallback = null) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error('分页或距离参数必须是数字');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }
  return parsed;
}

function boundedNumber(value, { name, fallback = null, min, max, integer = false }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    const error = new Error(`${name} 必须在 ${min}～${max} 之间${integer ? '且为整数' : ''}`);
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }
  return parsed;
}

function stringArray(value, name, maxItems = 20) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item.length > 100)) {
    const error = new Error(`${name} 必须是最多 ${maxItems} 个短文本组成的数组`);
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }
  return value.map(item => item.trim()).filter(Boolean);
}

router.get('/restaurants', async (req, res, next) => {
  try {
    const items = await catalog.listRestaurants({
      limit: boundedNumber(req.query.limit, { name: 'limit', fallback: 50, min: 1, max: 100, integer: true }),
      offset: boundedNumber(req.query.offset, { name: 'offset', fallback: 0, min: 0, max: 100000, integer: true }),
      area: String(req.query.area || ''),
    });
    res.json({ items });
  } catch (error) { next(error); }
});

router.get('/restaurants/:id', async (req, res, next) => {
  try {
    const item = await catalog.getRestaurant(req.params.id);
    if (!item) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '商家或分店不存在' } });
    return res.json({ item });
  } catch (error) { return next(error); }
});

router.get('/restaurants/:id/reviews', async (req, res, next) => {
  try {
    const items = await catalog.listReviews({
      branchId: req.params.id,
      dishId: String(req.query.dishId || ''),
      limit: boundedNumber(req.query.limit, { name: 'limit', fallback: 20, min: 1, max: 100, integer: true }),
      offset: boundedNumber(req.query.offset, { name: 'offset', fallback: 0, min: 0, max: 100000, integer: true }),
    });
    res.json({ items });
  } catch (error) { next(error); }
});

router.get('/restaurants/:id/dishes', async (req, res, next) => {
  try {
    const items = await catalog.listDishesByBranch({
      branchId: req.params.id,
      limit: boundedNumber(req.query.limit, { name: 'limit', fallback: 50, min: 1, max: 100, integer: true }),
      offset: boundedNumber(req.query.offset, { name: 'offset', fallback: 0, min: 0, max: 100000, integer: true }),
    });
    res.json({ items });
  } catch (error) { next(error); }
});

router.get('/dishes/:id', async (req, res, next) => {
  try {
    const item = await catalog.getDish(req.params.id);
    if (!item) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '菜品不存在' } });
    return res.json({ item });
  } catch (error) { return next(error); }
});

router.get('/dishes', async (req, res, next) => {
  try {
    const items = await catalog.listDishCandidates({
      lat: numberQuery(req.query.lat),
      lng: numberQuery(req.query.lng),
      radius: boundedNumber(req.query.radius, { name: 'radius', fallback: 3000, min: 100, max: 10000 }),
      limit: boundedNumber(req.query.limit, { name: 'limit', fallback: 100, min: 1, max: 500, integer: true }),
    });
    res.json({ items });
  } catch (error) { next(error); }
});

router.post('/discover', async (req, res, next) => {
  try {
    const body = req.body && !Array.isArray(req.body) ? req.body : {};
    const lat = boundedNumber(body.lat, { name: 'lat', fallback: null, min: -90, max: 90 });
    const lng = boundedNumber(body.lng, { name: 'lng', fallback: null, min: -180, max: 180 });
    if ((lat === null) !== (lng === null)) {
      const error = new Error('lat 和 lng 必须同时提供');
      error.code = 'VALIDATION_ERROR';
      error.status = 400;
      throw error;
    }
    const radius = boundedNumber(body.radius, { name: 'radius', fallback: 3000, min: 100, max: 10000 });
    const budget = boundedNumber(body.budget, { name: 'budget', fallback: 0, min: 0, max: 1000 });
    const limit = boundedNumber(body.limit, { name: 'limit', fallback: 20, min: 1, max: 40, integer: true });
    const tastes = stringArray(body.tastes, 'tastes');
    const excludeDishIds = stringArray(body.excludeDishIds, 'excludeDishIds', 100);
    const excludeBranchIds = stringArray(body.excludeBranchIds, 'excludeBranchIds', 100);
    const fulfillment = body.fulfillment === undefined ? 'dine_in' : String(body.fulfillment);
    if (!['dine_in', 'delivery'].includes(fulfillment)) {
      const error = new Error('fulfillment 只能是 dine_in 或 delivery');
      error.code = 'VALIDATION_ERROR';
      error.status = 400;
      throw error;
    }
    const spiceLevels = body.spiceLevels === undefined ? [] : body.spiceLevels;
    if (!Array.isArray(spiceLevels) || spiceLevels.length > 5 || spiceLevels.some(value => !Number.isInteger(value) || value < 0 || value > 4)) {
      const error = new Error('spiceLevels 只能包含 0～4 的整数');
      error.code = 'VALIDATION_ERROR';
      error.status = 400;
      throw error;
    }
    const [dishes, branches] = await Promise.all([
      catalog.listDishCandidates({ lat, lng, radius, limit: 300 }),
      catalog.listRecommendationBranches({ lat, lng, radius, limit: 300 }),
    ]);
    const items = recommendHybrid({ dishes, branches }, {
      mode: body.mode,
      limit,
      budget,
      radius,
      tastes,
      spiceLevels,
      excludeDishIds,
      excludeBranchIds,
      fulfillment,
      seed: String(body.sessionId || req.ip).slice(0, 200),
    });
    res.json({
      items,
      candidateCount: dishes.length + branches.length,
      candidateCounts: { dishes: dishes.length, foodCategories: branches.length },
      mode: body.mode === 'surprise' ? 'surprise' : 'gallery',
      fulfillment,
      imagePolicy: 'optional-not-scored',
    });
  } catch (error) { next(error); }
});

module.exports = router;
