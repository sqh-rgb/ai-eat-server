const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendDishes } = require('../src/services/dishRecommendationEngine');

const dishes = [
  { id: 'a', name: '重庆小面', category: '面食', cuisine: '面食', price: 10, spiceLevel: 2, distance: 300, reviewCount: 8, reviewRating: 4.5, image: null },
  { id: 'b', name: '豌杂面', category: '面食', cuisine: '面食', price: 12, spiceLevel: 2, distance: 350, reviewCount: 2, reviewRating: 4.2, image: 'https://example.invalid/b.jpg' },
  { id: 'c', name: '红油抄手', category: '面食', cuisine: '小吃', price: 14, spiceLevel: 3, distance: 420, reviewCount: 5, reviewRating: 4.3, image: null },
  { id: 'd', name: '鸡腿饭', category: '盖饭', cuisine: '快餐', price: 18, spiceLevel: 0, distance: 200, reviewCount: 1, reviewRating: 4.0, image: null },
];

test('surprise 模式只返回一道且遵守预算', () => {
  const result = recommendDishes(dishes, { mode: 'surprise', budget: 12, radius: 1000, seed: 'same' });
  assert.equal(result.length, 1);
  assert.ok(result[0].price <= 12 * 1.3);
});

test('gallery 模式提供品类多样性', () => {
  const result = recommendDishes(dishes, { mode: 'gallery', limit: 3, budget: 30, radius: 1000, seed: 'same' });
  assert.equal(result.length, 3);
  assert.ok(result.some(item => item.category === '盖饭'));
});

test('相同 seed 结果稳定', () => {
  const one = recommendDishes(dishes, { mode: 'gallery', limit: 4, seed: 'student-1' }).map(item => item.id);
  const two = recommendDishes(dishes, { mode: 'gallery', limit: 4, seed: 'student-1' }).map(item => item.id);
  assert.deepEqual(one, two);
});

test('结果包含前端可直接展示的推荐理由和分项得分', () => {
  const [item] = recommendDishes(dishes, { mode: 'surprise', budget: 20, tastes: ['面食'], radius: 1000, seed: 'reason' });
  assert.ok(Array.isArray(item.reasons));
  assert.ok(item.reasons.length > 0);
  assert.equal(typeof item.scoreBreakdown.price, 'number');
  assert.equal(typeof item.recommendationScore, 'number');
});

test('图片只改变展示素材，不改变推荐分数', () => {
  const base = { ...dishes[0], id: 'same-dish', image: null };
  const withoutImage = recommendDishes([base], { mode: 'surprise', seed: 'same' })[0];
  const withImage = recommendDishes([{ ...base, image: 'https://example.invalid/real.jpg' }], { mode: 'surprise', seed: 'same' })[0];
  assert.equal(withoutImage.recommendationScore, withImage.recommendationScore);
  assert.equal(withoutImage.visual.kind, 'category_illustration');
  assert.equal(withImage.visual.kind, 'real_image');
});
