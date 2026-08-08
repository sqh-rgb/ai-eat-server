/**
 * 评分引擎 — 五维加权评分公式
 * Score = 0.25×D + 0.30×P + 0.20×T + 0.15×R + 0.10×E
 */

// 菜系 → 口味映射
const CUISINE_SPICY = {
  '川菜': 'spicy', '湘菜': 'spicy', '江西菜': 'spicy', '重庆菜': 'spicy',
  '粤菜': 'mild', '苏菜': 'mild', '浙菜': 'mild', '闽菜': 'mild', '本帮菜': 'mild',
  '东北菜': 'neutral', '西北菜': 'neutral', '日韩料理': 'neutral',
  '面食': 'neutral', '小吃快餐': 'neutral', '火锅': 'spicy'
};

/** 距离评分 D（25%） — 阶梯分段 */
function scoreDistance(distance) {
  if (distance <= 500) return 10;
  if (distance <= 1000) return 8;
  if (distance <= 2000) return 6;
  if (distance <= 3000) return 4;
  return 2;
}

/** 预算评分 P（30%） */
function scoreBudget(avgCost, userBudget) {
  if (avgCost <= 0) return 5;                 // 无价格数据，中性分
  if (avgCost <= userBudget) return 10;       // 完全在预算内
  if (avgCost <= userBudget * 1.2) return 7;  // 超出不超过 20%
  if (avgCost <= userBudget * 1.5) return 4;  // 超出不超过 50%
  return 1;                                   // 超出太多
}

/** 口味评分 T（20%） */
function scoreTaste(restaurantCuisine, userTaste) {
  if (userTaste === 'any') return 5; // 用户无偏好

  const spicyLevel = CUISINE_SPICY[restaurantCuisine] || 'unknown';
  if (spicyLevel === 'unknown') return 5; // 菜系未知，中性分

  // 用户偏好映射
  const tasteMap = { 'nospicy': 'mild', 'mild': 'neutral', 'any': 'any' };
  const mapped = tasteMap[userTaste] || userTaste;

  if (mapped === 'any') return 5;
  if (spicyLevel === mapped) return 10;  // 完全匹配
  if (spicyLevel === 'neutral') return 5; // 菜系中性

  // 偏好不辣 but 菜系偏辣 → 低分但不为 0
  return mapped === 'mild' && spicyLevel === 'spicy' ? 2 : 5;
}

/** 综合评分 R（15%） — 高德星级 + 用户自评 */
function scoreRating(amapRating, userRating) {
  const amapScore = (amapRating || 3) * 2; // 转 10 分制
  if (!userRating) return amapScore;       // 冷启动，纯用高德
  const userScore = userRating * 2;
  return amapScore * 0.6 + userScore * 0.4;
}

/** 个性化评分 E（10%） — 余弦相似度简化版 */
function scorePersonal(restaurantCuisine, userPrefCuisines) {
  if (!userPrefCuisines || userPrefCuisines.length === 0) return 0; // 冷启动
  if (userPrefCuisines.includes(restaurantCuisine)) return 10;       // 精确命中
  // 检查菜系语义相似（同属 spicy/mild）
  const rLevel = CUISINE_SPICY[restaurantCuisine] || 'unknown';
  const hitsSame = userPrefCuisines.some(c => CUISINE_SPICY[c] && CUISINE_SPICY[c] === rLevel);
  return hitsSame ? 7 : 3;
}

/**
 * 对候选餐厅列表逐条评分
 * @param {Array} restaurants 候选餐厅列表
 * @param {Object} params 用户条件
 * @returns {Array} 附带 score + dimensions 的结果
 */
function scoreAll(restaurants, { budget, taste, userRatingMap, userPrefCuisines }) {
  const userRatings = userRatingMap || {};
  const prefCuisines = userPrefCuisines || [];

  return restaurants.map(r => {
    const D = scoreDistance(r.distance);
    const P = scoreBudget(r.avg_cost, budget);
    const T = scoreTaste(r.cuisine, taste);
    const R = scoreRating(r.rating, userRatings[r.id]);
    const E = scorePersonal(r.cuisine, prefCuisines);

    const score = 0.25 * D + 0.30 * P + 0.20 * T + 0.15 * R + 0.10 * E;

    return {
      ...r,
      score: Math.round(score * 10) / 10,
      dimensions: { D, P, T, R, E }
    };
  });
}

/**
 * 排序 + 过滤 + 取 Top N
 * @param {Array} scored 已评分的餐厅列表
 * @param {Object} opts { topN, minScore }
 * @returns {Array}
 */
function rankAndFilter(scored, opts = {}) {
  const { topN = 5, minScore = 3 } = opts;

  // 滤除已打烊 + 低分
  const filtered = scored
    .filter(s => s.status !== 'closed')
    .filter(s => s.score >= minScore);

  // 按 Score 降序排列，加微小随机扰动避免每次完全一致
  return filtered
    .sort((a, b) => (b.score + Math.random() * 0.1) - (a.score + Math.random() * 0.1))
    .slice(0, topN);
}

module.exports = { scoreAll, rankAndFilter, scoreDistance, scoreBudget, scoreTaste, scoreRating, scorePersonal };
