const HALF_MONTH_FORMULA_VERSION = 'half-month-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function periodFor(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) throw new Error('评分结算日期无效');
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  // 定时任务在每月 1 日和 16 日运行，结算刚结束的半月，避免给未来日期打快照。
  const start = day >= 16 ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year, month - 1, 16));
  const end = day >= 16 ? new Date(Date.UTC(year, month, 15)) : new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function deduplicateThirtyDayRatings(ratings) {
  const latest = new Map();
  for (const rating of ratings) {
    const submittedAt = new Date(rating.submittedAt || rating.submitted_at);
    if (Number.isNaN(submittedAt.getTime())) continue;
    const bucket = Math.floor(submittedAt.getTime() / (30 * DAY_MS));
    const key = `${rating.userSubjectHash || rating.user_subject_hash}:${bucket}`;
    const previous = latest.get(key);
    if (!previous || submittedAt > previous.submittedAt) latest.set(key, { ...rating, submittedAt });
  }
  return [...latest.values()];
}

function aggregateBranchRating({ externalRating, ratings = [], platformMean = 4, asOf = new Date() }) {
  const now = new Date(asOf);
  if (Number.isNaN(now.getTime())) throw new Error('评分结算日期无效');
  const valid = deduplicateThirtyDayRatings(ratings);
  let effectiveCount = 0;
  let weightedRatingSum = 0;
  for (const item of valid) {
    const rating = finiteOrNull(item.rating);
    if (rating === null || rating < 1 || rating > 5 || item.submittedAt > now) continue;
    const trust = clamp(finiteOrNull(item.trustWeight ?? item.trust_weight) ?? 1, 0, 1.2);
    const ageDays = Math.max(0, (now - item.submittedAt) / DAY_MS);
    const weight = trust * Math.exp(-ageDays / 180);
    effectiveCount += weight;
    weightedRatingSum += weight * rating;
  }
  const external = finiteOrNull(externalRating);
  const mean = clamp(finiteOrNull(platformMean) ?? 4, 1, 5);
  if (effectiveCount === 0) {
    return {
      currentRating: external,
      userBayesianRating: null,
      effectiveCount: 0,
      userWeight: 0,
      acceptedRatingCount: 0,
      formulaVersion: HALF_MONTH_FORMULA_VERSION,
    };
  }
  const userBayesianRating = (20 * mean + weightedRatingSum) / (20 + effectiveCount);
  const userWeight = effectiveCount / (effectiveCount + 30);
  const currentRating = external === null
    ? userBayesianRating
    : (1 - userWeight) * external + userWeight * userBayesianRating;
  return {
    currentRating: Math.round(clamp(currentRating, 1, 5) * 100) / 100,
    userBayesianRating: Math.round(userBayesianRating * 100) / 100,
    effectiveCount: Math.round(effectiveCount * 100) / 100,
    userWeight: Math.round(userWeight * 10000) / 10000,
    acceptedRatingCount: valid.length,
    formulaVersion: HALF_MONTH_FORMULA_VERSION,
  };
}

module.exports = { HALF_MONTH_FORMULA_VERSION, periodFor, deduplicateThirtyDayRatings, aggregateBranchRating };
