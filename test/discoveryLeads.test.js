const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLead } = require('../src/import/discoveryLeads');

test('社交平台只保存候选名称、菜品和证据链接', () => {
  const lead = normalizeLead({
    platform: 'douyin', candidateName: '学生小店', dishes: ['鸡腿饭', '鸡腿饭'],
    evidenceUrl: 'https://www.douyin.com/example', copiedComment: '不应保存的评论',
  });
  assert.deepEqual(lead.dishes, ['鸡腿饭']);
  assert.equal(Object.hasOwn(lead, 'copiedComment'), false);
});

test('拒绝无证据链接的社交线索', () => {
  assert.throws(() => normalizeLead({ platform: 'dianping', candidateName: '店铺' }), /证据链接/);
});
