/**
 * 推荐理由生成引擎 — 模板规则，不调用 LLM
 *
 * 每个维度 ≥ 8 分触发对应模板。每个餐厅最多 2 条理由。
 * 额外添加快递推荐（基于菜系）。
 */

// 菜系 → 招牌菜推荐
const DISH_RECOMMEND = {
  '川菜': '推荐：水煮鱼、麻婆豆腐',
  '湘菜': '推荐：剁椒鱼头、小炒肉',
  '粤菜': '推荐：白切鸡、煲仔饭',
  '苏菜': '推荐：松鼠鳜鱼、狮子头',
  '浙菜': '推荐：东坡肉、西湖醋鱼',
  '闽菜': '推荐：佛跳墙、荔枝肉',
  '火锅': '推荐：毛肚、虾滑',
  '面食': '推荐：招牌拉面、炸酱面',
  '小吃快餐': '推荐：招牌套餐',
  '日韩料理': '推荐：寿司拼盘、石锅拌饭',
  '东北菜': '推荐：锅包肉、酱骨架',
  '西北菜': '推荐：羊肉泡馍、大盘鸡',
  '烧烤': '推荐：羊肉串、烤茄子',
};

const TEMPLATES = [
  {
    key: 'distance',
    condition: (d) => d.D >= 8,
    template: (r) => `离你仅 ${r.distance} 米，步行 ${r.walkTime || Math.ceil(r.distance / 80)} 分钟`
  },
  {
    key: 'budget',
    condition: (d) => d.P === 10,
    template: (r, params) => `人均 ¥${r.avg_cost}，在你 ¥${params.budget} 预算内`
  },
  {
    key: 'taste',
    condition: (d) => d.T === 10,
    template: (r) => `${r.cuisine}——${DISH_RECOMMEND[r.cuisine] || '口味匹配你的偏好'}`
  },
  {
    key: 'rating',
    condition: (d) => d.R >= 8,
    template: (r) => `高德评分 ${r.rating || '暂无'}，口碑不错`
  },
  {
    key: 'personal',
    condition: (d) => d.E >= 7,
    template: () => '和你常去的风格类似'
  },
  {
    key: 'dish',
    condition: () => true,
    template: (r) => DISH_RECOMMEND[r.cuisine] || null
  },
  {
    key: 'fallback',
    condition: () => true,
    template: () => '综合推荐，值得一试'
  }
];

function generateReason(restaurant, userParams = {}) {
  const dims = restaurant.dimensions;
  if (!dims) return '综合推荐，值得一试';

  // 收集匹配的模板（最多 2 条）
  const matched = TEMPLATES
    .filter(t => {
      if (t.key === 'dish') return !!DISH_RECOMMEND[restaurant.cuisine];
      if (t.key === 'fallback') return false;
      return t.condition(dims);
    })
    .slice(0, 2);

  // 如果没匹配到任何理由，用 fallback
  if (matched.length === 0) {
    return TEMPLATES.find(t => t.key === 'fallback').template(restaurant, userParams);
  }

  const reasons = matched.map(t => t.template(restaurant, userParams)).filter(Boolean);
  
  // 如果没有 dish 推荐理由但有条推荐信息，尝试追加
  if (!matched.some(t => t.key === 'dish') && DISH_RECOMMEND[restaurant.cuisine] && reasons.length < 2) {
    reasons.push(DISH_RECOMMEND[restaurant.cuisine]);
  }

  return reasons.join('；');
}

function generateReasons(scored, userParams) {
  return scored.map(r => ({
    ...r,
    reason: generateReason(r, userParams)
  }));
}

module.exports = { generateReason, generateReasons };
