const test = require('node:test');
const assert = require('node:assert/strict');
const { periodFor, deduplicateThirtyDayRatings, aggregateBranchRating } = require('../src/services/ratingAggregation');

test('半月结算区间按每月一日和十六日切分', () => {
  assert.deepEqual(periodFor('2026-09-16T08:00:00Z'), { start: '2026-09-01', end: '2026-09-15' });
  assert.deepEqual(periodFor('2026-10-01T08:00:00Z'), { start: '2026-09-16', end: '2026-09-30' });
});

test('同一用户同一三十天时间桶只保留最后一次评分', () => {
  const rows = deduplicateThirtyDayRatings([
    { userSubjectHash: 'u1', rating: 2, submittedAt: '2026-09-01T00:00:00Z' },
    { userSubjectHash: 'u1', rating: 5, submittedAt: '2026-09-03T00:00:00Z' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 5);
});

test('少量用户评分经贝叶斯收缩后不会剧烈改变外部评分', () => {
  const result = aggregateBranchRating({
    externalRating: 4.2,
    platformMean: 4,
    asOf: '2026-09-10T00:00:00Z',
    ratings: [{ userSubjectHash: 'u1', rating: 5, trustWeight: 1, submittedAt: '2026-09-09T00:00:00Z' }],
  });
  assert.ok(result.currentRating > 4.19 && result.currentRating < 4.25);
  assert.ok(result.userWeight < 0.04);
});

test('没有有效用户评分时保留外部评分且不伪造本站评分', () => {
  const result = aggregateBranchRating({ externalRating: 4.3, ratings: [], platformMean: 4 });
  assert.equal(result.currentRating, 4.3);
  assert.equal(result.userBayesianRating, null);
  assert.equal(result.effectiveCount, 0);
});
