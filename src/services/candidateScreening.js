function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function radians(value) {
  return value * Math.PI / 180;
}

function haversineMeters(a, b) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const earth = 6371000;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function nearestCampusDistance(branch, points) {
  const origin = { lat: Number(branch.latitude), lng: Number(branch.longitude) };
  const distances = points.map(point => haversineMeters(origin, point)).filter(Number.isFinite);
  return distances.length ? Math.min(...distances) : null;
}

function scoreDistance(distance) {
  if (distance === null) return 3;
  if (distance <= 300) return 10;
  if (distance <= 600) return 9;
  if (distance <= 1000) return 8;
  if (distance <= 1500) return 6;
  if (distance <= 2200) return 4;
  if (distance <= 3000) return 2;
  return 0;
}

function scorePrice(cost) {
  if (cost === null) return 11;
  if (cost <= 15) return 25;
  if (cost <= 25) return 22;
  if (cost <= 35) return 17;
  if (cost <= 50) return 10;
  if (cost <= 70) return 4;
  return 0;
}

function includesAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

function scoreCategory(branch, config) {
  const text = `${branch.name || ''} ${branch.cuisine || ''}`;
  if (includesAny(text, config.unsuitableKeywords)) return 0;
  if (includesAny(text, config.studentFoodKeywords)) return 20;
  if (includesAny(text, config.groupMealKeywords)) return 8;
  if (text.includes('餐饮')) return 12;
  return 7;
}

function scoreRating(rating) {
  if (rating === null) return 3;
  if (rating >= 4.5) return 10;
  if (rating >= 4.2) return 9;
  if (rating >= 3.8) return 7;
  if (rating >= 3.5) return 5;
  if (rating >= 3) return 3;
  return 0;
}

function scoreCompleteness(branch) {
  let score = 0;
  if (branch.address) score += 1;
  if (branch.phone) score += 1;
  if (branch.avg_cost !== null) score += 1;
  if (branch.external_rating !== null) score += 1;
  if (Number.isFinite(Number(branch.latitude)) && Number.isFinite(Number(branch.longitude))) score += 1;
  return score;
}

function scoreTasteReviews(count) {
  if (count >= 12) return 20;
  if (count >= 8) return 17;
  if (count >= 5) return 14;
  if (count >= 3) return 11;
  if (count >= 2) return 8;
  if (count >= 1) return 5;
  return 0;
}

function scoreRecommendedDishes(count) {
  if (count >= 8) return 10;
  if (count >= 5) return 9;
  if (count >= 3) return 7;
  if (count >= 2) return 5;
  if (count >= 1) return 3;
  return 0;
}

function screenCandidate(branch, config) {
  const distance = nearestCampusDistance(branch, config.campusPoints);
  const cost = branch.avg_cost === null ? null : Number(branch.avg_cost);
  const rating = branch.external_rating === null ? null : Number(branch.external_rating);
  const tasteReviewCount = Number(branch.taste_review_count || 0);
  const recommendedDishCount = Number(branch.recommended_dish_count || 0);
  const text = `${branch.name || ''} ${branch.cuisine || ''}`;
  const scores = {
    distance: scoreDistance(distance),
    price: scorePrice(cost),
    category: scoreCategory(branch, config),
    rating: scoreRating(rating),
    completeness: scoreCompleteness(branch),
    tasteReviews: scoreTasteReviews(tasteReviewCount),
    recommendedDishes: scoreRecommendedDishes(recommendedDishCount),
  };
  const totalScore = clamp(Object.values(scores).reduce((sum, score) => sum + score, 0), 0, 100);
  const warnings = [];
  const reasons = [];
  if (distance !== null) reasons.push(`距最近校区采样点约 ${distance} 米`);
  else warnings.push('缺少有效坐标');
  if (cost === null) warnings.push('缺少人均价格，需人工补充');
  else if (cost <= 25) reasons.push(`人均约 ${cost} 元，适合学生日常消费`);
  else if (cost > 70) warnings.push(`人均约 ${cost} 元，价格偏高`);
  if (includesAny(text, config.studentFoodKeywords)) reasons.push('名称或分类命中学生常吃品类');
  if (includesAny(text, config.groupMealKeywords)) warnings.push('偏多人聚餐，单人推荐需核实');
  if (includesAny(text, config.unsuitableKeywords)) warnings.push('疑似非日常正餐场所，建议低优先审核');
  if (rating !== null && rating >= 4.2) reasons.push(`高德评分 ${rating}`);
  if (rating !== null && rating < 3) warnings.push(`高德评分仅 ${rating}，需核实数据质量或经营状态`);
  if (!branch.phone) warnings.push('缺少电话');
  if (tasteReviewCount === 0) warnings.push('尚无已映射的味道评价');
  else reasons.push(`已收集 ${tasteReviewCount} 条味道相关评价`);
  if (recommendedDishCount === 0) warnings.push('尚无已核验的推荐菜品');
  else reasons.push(`已有 ${recommendedDishCount} 道推荐菜品`);
  const priority = totalScore >= config.priorityThreshold
    ? 'priority'
    : totalScore >= config.normalThreshold ? 'normal' : 'low';
  return {
    ...branch, taste_review_count: tasteReviewCount, recommended_dish_count: recommendedDishCount,
    distance_meters: distance, total_score: totalScore, priority, scores, reasons, warnings,
  };
}

function screenCandidates(branches, config) {
  return branches.map(branch => screenCandidate(branch, config))
    .sort((a, b) => b.total_score - a.total_score
      || (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity)
      || String(a.name).localeCompare(String(b.name), 'zh-CN'))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

module.exports = { haversineMeters, screenCandidate, screenCandidates };
