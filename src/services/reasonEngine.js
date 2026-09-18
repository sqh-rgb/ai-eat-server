/**
 * 推荐理由生成引擎
 * 包含：距离/预算/口味/评分/个性化/菜品推荐
 */

// 菜系 → 招牌菜
const DISHES = {
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
  '中餐厅': '推荐：招牌菜式',
  '其他': '',
};

const TEMPLATES = [
  {
    key: 'distance',
    condition: d => d.D >= 8,
    template: r => `离你仅 ${r.distance} 米，步行 ${r.walkTime || Math.ceil(r.distance / 80)} 分钟`,
  },
  {
    key: 'budget',
    condition: d => d.P === 10,
    template: (r, p) => `人均 ¥${r.avg_cost}，在你 ¥${p.budget} 预算内`,
  },
  {
    key: 'taste',
    condition: d => d.T === 10,
    template: r => {
      const dish = DISHES[r.cuisine];
      return dish ? `${r.cuisine}——${dish}` : `${r.cuisine}，符合你的口味偏好`;
    },
  },
  {
    key: 'rating',
    condition: d => d.R >= 7,
    template: r => {
      const rt = r.rating && r.rating > 1 ? `高德评分 ${r.rating} 星` : '食客口碑认可';
      return rt;
    },
  },
  {
    key: 'dish',
    condition: () => true,
    template: r => DISHES[r.cuisine] || null,
  },
  {
    key: 'fallback',
    condition: () => true,
    template: () => '综合推荐，值得一试',
  },
];

function generateReason(restaurant, userParams = {}) {
  const dims = restaurant.dimensions;
  if (!dims) return '综合推荐，值得一试';

  const matched = TEMPLATES
    .filter(t => {
      if (t.key === 'dish') return !!DISHES[restaurant.cuisine];
      if (t.key === 'fallback') return false;
      return t.condition(dims);
    })
    .slice(0, 2);

  if (matched.length === 0) {
    return TEMPLATES.find(t => t.key === 'fallback').template(restaurant, userParams);
  }

  const reasons = matched.map(t => t.template(restaurant, userParams)).filter(Boolean);

  // 没有菜品推荐时补一个
  if (!matched.some(t => t.key === 'dish') && DISHES[restaurant.cuisine] && reasons.length < 2) {
    reasons.push(DISHES[restaurant.cuisine]);
  }

  // 没有评分信息时补一个
  if (!matched.some(t => t.key === 'rating') && restaurant.rating && restaurant.rating > 1) {
    reasons.push(`高德评分 ${restaurant.rating} 星`);
  }

  return reasons.join('；');
}

function generateReasons(scored, userParams) {
  return scored.map(r => ({
    ...r,
    reason: generateReason(r, userParams),
  }));
}

module.exports = { generateReason, generateReasons };
