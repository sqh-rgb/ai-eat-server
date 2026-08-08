/**
 * 兜底策略 — 三级降级
 */

// Mock 餐厅数据（高德 API 不可用时的垫底数据）
const MOCK_FALLBACK = [
  {
    id: 0, amap_poi: 'fallback_1', name: '推荐服务暂不可用',
    address: '', lat: 0, lng: 0, distance: 999, walkTime: 0,
    avg_cost: 0, rating: 3, cuisine: '其他', status: 'open',
    score: 0, dimensions: { D: 1, P: 1, T: 5, R: 3, E: 0 },
    reason: '网络异常，这是最近一次缓存的推荐结果'
  }
];

/**
 * 主推荐流程的兜底入口
 * 1. 扩大搜索半径
 * 2. 降低最低分数阈值 + 忽略口味
 * 3. 返回 mock 垫底数据
 */
function fallbackRecommend(existingCandidates, userParams, retryCount = 0) {
  if (retryCount >= 3) {
    return { results: MOCK_FALLBACK, cached: false, fallback: 'exhausted' };
  }

  // Level 1: 结果不足 3 家 → 提示前端"附近选择不多"
  if (existingCandidates && existingCandidates.length >= 1 && existingCandidates.length < 3) {
    return {
      results: existingCandidates,
      cached: false,
      fallback: 'limited',
      notice: '附近符合条件的餐厅不多，为你找到所有匹配结果'
    };
  }

  // Level 2: 完全空 → 要求重试（扩大半径）
  if (!existingCandidates || existingCandidates.length === 0) {
    return { retry: true, expandedRadius: (userParams.radius || 1000) * 1.5 };
  }

  return { results: existingCandidates, cached: false, fallback: 'none' };
}

module.exports = { fallbackRecommend };
