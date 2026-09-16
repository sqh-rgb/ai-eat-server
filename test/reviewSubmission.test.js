const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReviewSubmission } = require('../src/services/reviewSubmission');

test('用户评价候选支持文字、Emoji、评分和审核前图片元数据', () => {
  const result = validateReviewSubmission({
    branchId: 'branch-1',
    publicText: '小面很好吃 😋',
    rating: 5,
    media: [{
      mediaKind: 'review_photo', storageKey: 'pending/u1/photo.webp',
      mimeType: 'image/webp', byteSize: 2048, width: 800, height: 600,
      rightsConfirmed: true,
    }],
  });
  assert.equal(result.publicText, '小面很好吃 😋');
  assert.equal(result.media.length, 1);
});

test('拒绝把远程 URL 或 data URL 当成已审核存储键', () => {
  assert.throws(() => validateReviewSubmission({
    branchId: 'branch-1', rating: 4,
    media: [{ mediaKind: 'sticker', storageKey: 'https://example.com/a.gif', mimeType: 'image/gif', byteSize: 12 }],
  }), /storageKey/);
});

test('评价文字和评分至少提供一项', () => {
  assert.throws(() => validateReviewSubmission({ branchId: 'branch-1' }), /至少填写一项/);
});
