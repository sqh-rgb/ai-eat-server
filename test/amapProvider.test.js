const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePoi, collectPois } = require('../src/providers/amapProvider');

test('规范化高德 POI 并保留候选照片证据', () => {
  const poi = normalizePoi({
    id: 'B001', name: '学生小面', location: '106.42,29.82', address: '天生路2号',
    type: '餐饮服务;中餐厅', typecode: '050100',
    business: { alias: '小面店', rating: '4.2', cost: '12', tel: '123' },
    photos: [{ title: '门店', url: 'https://example.invalid/photo.jpg' }],
  });
  assert.equal(poi.externalId, 'B001');
  assert.equal(poi.lat, 29.82);
  assert.equal(poi.cost, 12);
  assert.equal(poi.photos.length, 1);
});

test('QPS 限流会自动退避重试，并逐页报告可保存进度', async () => {
  let calls = 0;
  const pages = [];
  const result = await collectPois({
    points: [{ label: '校门', lat: 29.8, lng: 106.4 }], keywords: ['小吃'],
    maxPages: 1, keywordMaxPages: 1, pageSize: 5, delayMs: 0,
  }, {
    retryBaseMs: 0,
    maxRetries: 2,
    async fetchPage() {
      calls += 1;
      if (calls === 1) {
        const error = new Error('高德地点搜索失败：CUQPS_HAS_EXCEEDED_THE_LIMIT');
        error.code = 'CUQPS_HAS_EXCEEDED_THE_LIMIT';
        throw error;
      }
      return { pois: [{ externalId: 'B001', name: '学生小店' }], requestUrl: 'redacted' };
    },
    async onPage(page) { pages.push(page); },
  });
  assert.equal(calls, 2);
  assert.equal(result.pois.length, 1);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].uniqueCount, 1);
});
