const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprintReviewText, assessReviewRisk } = require('../src/services/reviewFraudGuard');

test('标准化文案指纹能识别空格和标点变化的重复评价', () => {
  assert.equal(fingerprintReviewText('真的 好吃！！！'), fingerprintReviewText('真的好吃'));
});

test('已认证商家评价自己的门店会被直接拦截', () => {
  const result = assessReviewRisk({
    rating: 5,
    publicText: '非常好吃',
    isVerifiedMerchantForBranch: true,
    counts: {},
  });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.riskScore, 100);
  assert.ok(result.signals.some(signal => signal.code === 'MERCHANT_SELF_REVIEW'));
});

test('设备集中评价和重复文案进入人工风控审核', () => {
  const result = assessReviewRisk({
    rating: 5,
    publicText: '推荐这家店',
    counts: { sameDeviceBranch24h: 3, sameContent90d: 1 },
  });
  assert.equal(result.decision, 'manual_review');
  assert.equal(result.riskScore, 75);
  assert.equal(result.suggestedTrustWeight, 0);
});

test('普通评价仍需常规内容审核但不会被风控误拦截', () => {
  const result = assessReviewRisk({
    rating: 4,
    publicText: '牛肉份量不错，晚饭时间排队十分钟',
    accountAgeDays: 90,
    counts: {},
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.riskScore, 0);
});
