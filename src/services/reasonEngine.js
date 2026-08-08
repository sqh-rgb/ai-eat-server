/**
 * 推荐理由生成引擎 — 模板规则，不调用 LLM
 *
 * 每个维度 ≥ 8 分触发对应模板。每个餐厅最多 2 条理由。
 */

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
    template: (r) => `${r.cuisine}，符合你的口味偏好`
  },
  {
    key: 'rating',
    condition: (d) => d.R >= 8,
    template: (r) => `综合评分 ${r.rating}，口碑不错`
  },
  {
    key: 'personal',
    condition: (d) => d.E >= 7,
    template: () => '和你常去的风格类似'
  },
  {
    key: 'fallback',
    condition: () => true,
    template: () => '综合推荐，值得一试'
  }
];

/**
 * 为单家餐厅生成推荐理由
 * @param {Object} restaurant 附带 dimensions 和 score 的餐厅对象
 * @param {Object} userParams 用户条件
 * @returns {string} 推荐理由文本
 */
function generateReason(restaurant, userParams = {}) {
  const dims = restaurant.dimensions;
  if (!dims) return '综合推荐，值得一试';

  const matched = TEMPLATES
    .filter(t => t.condition(dims))
    .slice(0, 2);

  if (matched.length === 0) {
    return TEMPLATES.find(t => t.key === 'fallback').template(restaurant, userParams);
  }

  return matched.map(t => t.template(restaurant, userParams)).join('，');
}

/**
 * 为结果列表批量生成理由
 */
function generateReasons(scored, userParams) {
  return scored.map(r => ({
    ...r,
    reason: generateReason(r, userParams)
  }));
}

module.exports = { generateReason, generateReasons };
