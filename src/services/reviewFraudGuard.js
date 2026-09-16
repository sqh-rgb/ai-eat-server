const crypto = require('node:crypto');

const REVIEW_FRAUD_VERSION = 'review-fraud-v1';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fingerprintReviewText(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 2000);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function assessReviewRisk(input = {}) {
  const counts = input.counts || {};
  const rating = Number(input.rating || 0);
  const signals = [];
  let riskScore = 0;
  let hardBlock = false;

  const add = (code, points, detail) => {
    signals.push({ code, points, detail });
    riskScore += points;
  };

  if (input.isVerifiedMerchantForBranch) {
    add('MERCHANT_SELF_REVIEW', 100, '已认证商家账号不得评价自己的门店');
    hardBlock = true;
  }
  if (Number(counts.sameUserBranch30d || 0) >= 1) {
    add('REPEAT_USER_BRANCH_30D', 45, '同一用户三十天内重复评价同一门店');
  }
  if (Number(counts.sameContent90d || 0) >= 1) {
    add('DUPLICATE_CONTENT_90D', 40, '相同或标准化后相同的文案近期已出现');
  }
  if (Number(counts.userHour || 0) >= 5) {
    add('USER_BURST_HOUR', 30, '同一用户一小时内提交过于频繁');
  }
  if (Number(counts.userDay || 0) >= 20) {
    add('USER_BURST_DAY', 60, '同一用户一天内提交量异常');
    hardBlock = true;
  }
  if (Number(counts.sameDeviceBranch24h || 0) >= 3) {
    add('DEVICE_BRANCH_BURST', 35, '同一设备短期集中评价同一门店');
  }
  if (Number(counts.sameNetworkBranchHour || 0) >= 8) {
    add('NETWORK_BRANCH_BURST', 30, '同一网络短期集中评价同一门店');
  }
  if (Number(counts.branchFiveStarHour || 0) >= 8 && rating === 5) {
    add('FIVE_STAR_BURST', 35, '门店短期出现集中五星评价');
  }
  if (input.accountAgeDays !== undefined && Number(input.accountAgeDays) < 7 && rating === 5) {
    add('NEW_ACCOUNT_FIVE_STAR', 10, '新账号提交五星评价');
  }

  riskScore = clamp(riskScore, 0, 100);
  const decision = hardBlock || riskScore >= 80
    ? 'blocked'
    : riskScore >= 30 ? 'manual_review' : 'allow';

  return {
    decision,
    riskScore,
    signals,
    evaluatorVersion: REVIEW_FRAUD_VERSION,
    contentFingerprint: fingerprintReviewText(input.publicText),
    // 只有低风险且最终人工批准的评分才应进入半月评分计算。
    suggestedTrustWeight: decision === 'allow' ? 1 : 0,
  };
}

module.exports = { REVIEW_FRAUD_VERSION, fingerprintReviewText, assessReviewRisk };
