const { Router } = require('express');
const { getPool } = require('../db/pool');
const { aggregateRatings } = require('../jobs/aggregateRatings');

const router = Router();

router.get('/ratings/aggregate', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: { code: 'CRON_NOT_CONFIGURED', message: '定时任务密钥尚未配置' } });
    if (req.get('authorization') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '无权执行评分结算' } });
    }
    const result = await aggregateRatings({ pool: getPool(), asOf: new Date() });
    return res.json({ status: 'completed', ...result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
