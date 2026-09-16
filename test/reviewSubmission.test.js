const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReviewSubmission } = require('../src/services/reviewSubmission');

test('用户评价候选只接受上传意图 ID 和权利确认', () => {
  const result = validateReviewSubmission({
    branchId: 'branch-1',
    publicText: '小面很好吃 😋',
    rating: 5,
    media: [{
      uploadIntentId: 'upload-1', rightsConfirmed: true,
    }],
  });
  assert.equal(result.publicText, '小面很好吃 😋');
  assert.deepEqual(result.media, [{ uploadIntentId: 'upload-1', rightsConfirmed: true }]);
});

test('拒绝旧版客户端自报存储键和媒体元数据协议', () => {
  assert.throws(() => validateReviewSubmission({
    branchId: 'branch-1', rating: 4,
    media: [{ mediaKind: 'sticker', storageKey: 'https://example.com/a.gif', mimeType: 'image/gif', byteSize: 12 }],
  }), /上传意图/);
});

test('评价文字和评分至少提供一项', () => {
  assert.throws(() => validateReviewSubmission({ branchId: 'branch-1' }), /至少填写一项/);
});
