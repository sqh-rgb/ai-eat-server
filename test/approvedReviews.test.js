const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareBatch, validateReview } = require('../src/import/approvedReviews');

const valid = {
  _id: 'public-1',
  restaurantId: 'B001TEST',
  publicText: '很好吃，适合学生。',
  sourceCommentHash: 'hash-1',
  publicMedia: [],
  status: 'published',
};

test('只接受 approved-only 文字评论', () => {
  const record = validateReview(valid);
  assert.equal(record.branchId, 'B001TEST');
  assert.equal(record.publicText, valid.publicText);
});

test('拒绝带采集图片的数据包', () => {
  assert.throws(() => validateReview({ ...valid, publicMedia: ['x.jpg'] }), /第一版禁止/);
});

test('批次摘要稳定并检测重复', () => {
  const text = `${JSON.stringify(valid)}\n`;
  assert.equal(prepareBatch(text).sha256, prepareBatch(text).sha256);
  assert.throws(() => prepareBatch(`${text}${text}`), /重复评论ID/);
});
