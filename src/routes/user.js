const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const defaultUsers = require('../repositories/userRepository');
const defaultUploads = require('../services/storageUploads');

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function shortId(value, name) {
  const result = String(value || '').trim();
  if (!result || result.length > 200) throw validationError(`${name} 无效`);
  return result;
}

function boundedNumber(value, name, min, max, { integer = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw validationError(`${name} 必须在 ${min}～${max} 之间${integer ? '且为整数' : ''}`);
  }
  return result;
}

function textArray(value, name, maxItems = 20) {
  if (!Array.isArray(value) || value.length > maxItems ||
      value.some(item => typeof item !== 'string' || !item.trim() || item.length > 50)) {
    throw validationError(`${name} 必须是最多 ${maxItems} 个短文本组成的数组`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

function pagination(query) {
  return {
    limit: boundedNumber(query.limit, 'limit', 1, 100, { integer: true, fallback: 20 }),
    offset: boundedNumber(query.offset, 'offset', 0, 100000, { integer: true, fallback: 0 }),
  };
}

function createUserRouter({ users = defaultUsers, uploads = defaultUploads } = {}) {
  const router = Router();
  router.use('/user', requireAuth);
  router.use('/favorites', requireAuth);
  router.use('/records', requireAuth);
  router.use('/recommendation-events', requireAuth);

  router.post('/user/uploads', async (req, res, next) => {
    try {
      const item = await uploads.issueUpload({
        userId: req.userId, userSubjectHash: req.userSubjectHash,
        accessToken: req.authToken, input: req.body,
      });
      return res.status(201).json({ item });
    } catch (error) { return next(error); }
  });

  router.post('/user/uploads/:id/confirm', async (req, res, next) => {
    try {
      const item = await uploads.confirmUpload({
        userId: req.userId, accessToken: req.authToken,
        intentId: shortId(req.params.id, '上传 ID'),
      });
      return res.json({ item });
    } catch (error) { return next(error); }
  });

  router.get('/user/uploads/:id/preview', async (req, res, next) => {
    try {
      const item = await uploads.createPreviewUrl({
        userId: req.userId, accessToken: req.authToken,
        intentId: shortId(req.params.id, '上传 ID'),
      });
      return res.json({ item });
    } catch (error) { return next(error); }
  });

  router.delete('/user/uploads/:id', async (req, res, next) => {
    try {
      await uploads.deleteUpload({ userId: req.userId, intentId: shortId(req.params.id, '上传 ID') });
      return res.status(204).end();
    } catch (error) { return next(error); }
  });

router.get('/user/preferences', async (req, res, next) => {
  try { return res.json({ preferences: await users.getPreferences(req.userId) }); }
  catch (error) { return next(error); }
});

router.put('/user/preferences', async (req, res, next) => {
  try {
    const spiceLevels = Array.isArray(req.body?.spiceLevels) ? req.body.spiceLevels : [];
    if (spiceLevels.length > 5 || spiceLevels.some(value => !Number.isInteger(value) || value < 0 || value > 4)) {
      throw validationError('spiceLevels 只能包含 0～4 的整数');
    }
    const fulfillment = String(req.body?.defaultFulfillment || 'dine_in');
    if (!['dine_in', 'delivery'].includes(fulfillment)) throw validationError('defaultFulfillment 无效');
    const preferences = await users.savePreferences(req.userId, {
      tastes: textArray(req.body?.tastes || [], 'tastes'),
      spiceLevels: [...new Set(spiceLevels)],
      defaultBudget: boundedNumber(req.body?.defaultBudget, 'defaultBudget', 0, 1000, { fallback: 30 }),
      defaultRadius: boundedNumber(req.body?.defaultRadius, 'defaultRadius', 100, 10000, { integer: true, fallback: 2000 }),
      defaultFulfillment: fulfillment,
    });
    return res.json({ preferences });
  } catch (error) { return next(error); }
});

router.get('/favorites', async (req, res, next) => {
  try { return res.json({ items: await users.listFavorites(req.userId) }); }
  catch (error) { return next(error); }
});

router.post('/favorites', async (req, res, next) => {
  try {
    const item = await users.addFavorite(req.userId, shortId(req.body?.branchId, 'branchId'));
    return res.status(201).json({ item });
  } catch (error) { return next(error); }
});

router.delete('/favorites/:id', async (req, res, next) => {
  try {
    const removed = await users.removeFavorite(req.userId, shortId(req.params.id, '收藏 ID'));
    return removed ? res.status(204).end() : res.status(404).json({ error: { code: 'NOT_FOUND', message: '收藏不存在' } });
  } catch (error) { return next(error); }
});

router.get('/records', async (req, res, next) => {
  try { return res.json({ items: await users.listConsumptionRecords(req.userId, pagination(req.query)) }); }
  catch (error) { return next(error); }
});

router.post('/records', async (req, res, next) => {
  try {
    const consumedAt = req.body?.consumedAt ? new Date(req.body.consumedAt) : new Date();
    if (Number.isNaN(consumedAt.getTime()) || consumedAt > new Date(Date.now() + 7 * 86400000)) {
      throw validationError('consumedAt 无效');
    }
    const note = String(req.body?.note || '').trim();
    if (note.length > 500) throw validationError('note 不能超过 500 字符');
    const item = await users.addConsumptionRecord(req.userId, {
      branchId: shortId(req.body?.branchId, 'branchId'),
      dishId: req.body?.dishId ? shortId(req.body.dishId, 'dishId') : null,
      consumedAt, amount: boundedNumber(req.body?.amount, 'amount', 0, 10000), note,
    });
    return res.status(201).json({ item });
  } catch (error) { return next(error); }
});

router.post('/recommendation-events', async (req, res, next) => {
  try {
    const eventType = String(req.body?.eventType || '');
    if (!['shown', 'opened', 'accepted', 'dismissed'].includes(eventType)) throw validationError('eventType 无效');
    const branchId = req.body?.branchId ? shortId(req.body.branchId, 'branchId') : null;
    const dishId = req.body?.dishId ? shortId(req.body.dishId, 'dishId') : null;
    if (!branchId && !dishId) throw validationError('branchId 和 dishId 至少填写一个');
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
      ? req.body.metadata : {};
    if (JSON.stringify(metadata).length > 2000) throw validationError('metadata 过大');
    const item = await users.recordRecommendationEvent(req.userId, {
      eventType, branchId, dishId, metadata,
      sessionId: String(req.body?.sessionId || '').slice(0, 200) || null,
      clientEventId: String(req.body?.clientEventId || '').slice(0, 200) || null,
    });
    return res.status(item.duplicate ? 200 : 201).json({ item });
  } catch (error) { return next(error); }
});

router.get('/user/reviews', async (req, res, next) => {
  try { return res.json({ items: await users.listOwnReviewSubmissions(req.userSubjectHash, pagination(req.query)) }); }
  catch (error) { return next(error); }
});

router.post('/user/reviews', async (req, res, next) => {
  try {
    const deviceValue = String(req.get('x-ai-eat-device-id') || '').trim();
    if (deviceValue.length > 200) throw validationError('设备标识过长');
    const item = await users.createReviewSubmission({
      userId: req.userId,
      userSubjectHash: req.userSubjectHash,
      networkValue: req.ip,
      deviceValue,
      input: req.body,
    });
    return res.status(item.duplicate ? 200 : 201).json({
      item,
      message: item.status === 'rejected' ? '评价被风控拦截' : '评价已进入审核队列',
    });
  } catch (error) { return next(error); }
});

  return router;
}

const router = createUserRouter();

module.exports = { router, createUserRouter, textArray, boundedNumber, pagination };
