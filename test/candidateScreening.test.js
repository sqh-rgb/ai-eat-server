const test = require('node:test');
const assert = require('node:assert/strict');
const { screenCandidate, screenCandidates } = require('../src/services/candidateScreening');

const config = {
  campusPoints: [{ label: '校门', lat: 29.8169, lng: 106.424 }],
  priorityThreshold: 70,
  normalThreshold: 55,
  studentFoodKeywords: ['小面', '快餐'],
  groupMealKeywords: ['火锅'],
  unsuitableKeywords: ['茶楼', '棋牌'],
};

test('近校低价小店进入优先审核并给出可解释原因', () => {
  const result = screenCandidate({
    id: 'small', name: '学生小面', cuisine: '快餐', latitude: 29.817, longitude: 106.424,
    avg_cost: '12', external_rating: '4.5', address: '天生路', phone: '123',
    taste_review_count: 8, recommended_dish_count: 5,
  }, config);
  assert.equal(result.priority, 'priority');
  assert.ok(result.total_score >= 70);
  assert.ok(result.reasons.some(reason => reason.includes('学生')));
});

test('茶楼棋牌与高价场所降为低优先但不自动拒绝', () => {
  const result = screenCandidate({
    id: 'tea', name: '休闲茶楼棋牌', cuisine: '茶艺馆', latitude: 29.817, longitude: 106.424,
    avg_cost: '88', external_rating: '3.2', address: '附近', phone: '',
    taste_review_count: 0, recommended_dish_count: 0,
  }, config);
  assert.equal(result.priority, 'low');
  assert.ok(result.warnings.some(warning => warning.includes('非日常正餐')));
});

test('缺少价格的小店仍可进入审核而不是被直接淘汰', () => {
  const [result] = screenCandidates([{
    id: 'unknown-price', name: '巷子快餐', cuisine: '快餐', latitude: 29.817, longitude: 106.424,
    avg_cost: null, external_rating: '4.3', address: '附近', phone: '',
    taste_review_count: 5, recommended_dish_count: 3,
  }], config);
  assert.notEqual(result.priority, 'low');
  assert.ok(result.warnings.some(warning => warning.includes('缺少人均价格')));
  assert.equal(result.rank, 1);
});

test('真实味道评价和推荐菜品合计最多贡献三十分', () => {
  const result = screenCandidate({
    id: 'evidence', name: '普通餐馆', cuisine: '餐饮', latitude: 29.817, longitude: 106.424,
    avg_cost: '25', external_rating: '4.2', address: '附近', phone: '123',
    taste_review_count: 12, recommended_dish_count: 8,
  }, config);
  assert.equal(result.scores.tasteReviews, 20);
  assert.equal(result.scores.recommendedDishes, 10);
});
