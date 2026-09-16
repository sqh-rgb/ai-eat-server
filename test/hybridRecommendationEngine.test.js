const test = require('node:test');
const assert = require('node:assert/strict');
const { inferFoodCategory, recommendHybrid } = require('../src/services/hybridRecommendationEngine');

test('根据已审核商家名称或分类推荐食物类型而不虚构菜名', () => {
  const branch = { id: 'b1', name: '老街小面', cuisine: '快餐;面馆', avgCost: 12, distance: 500, reviewCount: 3 };
  assert.equal(inferFoodCategory(branch).label, '小面');
  const [item] = recommendHybrid({ dishes: [], branches: [branch] }, { mode: 'surprise', budget: 20, radius: 2000, seed: 'x' });
  assert.equal(item.recommendationType, 'food_category');
  assert.equal(item.menuVerified, false);
  assert.equal(item.displayTitle, '今天吃小面');
  assert.equal(item.visual.label, '分类示意图');
});

test('有具体菜品时画廊优先菜品并用分类示意图补位', () => {
  const dishes = [{
    id: 'd1', branchId: 'b1', name: '豌杂面', category: '小面', cuisine: '面食', price: 12,
    spiceLevel: 2, distance: 300, reviewCount: 5, reviewRating: 4.4, image: null,
  }];
  const branches = [{ id: 'b2', name: '校园奶茶', cuisine: '茶饮', avgCost: 10, distance: 400, reviewCount: 2 }];
  const items = recommendHybrid({ dishes, branches }, { mode: 'gallery', limit: 2, budget: 20, radius: 2000, seed: 'x' });
  assert.equal(items.length, 2);
  assert.equal(items[0].recommendationType, 'dish');
  assert.equal(items[0].visual.kind, 'category_illustration');
  assert.equal(items[1].recommendationType, 'food_category');
});

test('无法可靠判断食物类型的商家不进入主要推荐', () => {
  const items = recommendHybrid({ dishes: [], branches: [{ id: 'b1', name: '某某餐饮', cuisine: '中餐厅' }] }, { seed: 'x' });
  assert.deepEqual(items, []);
});
