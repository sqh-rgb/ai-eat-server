const crypto = require('node:crypto');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableNoise(seed, id) {
  const digest = crypto.createHash('sha256').update(`${seed}:${id}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function preferenceScore(dish, tastes) {
  if (!tastes.length) return 15;
  const haystack = `${dish.name} ${dish.category} ${dish.cuisine}`.toLowerCase();
  return tastes.some(taste => haystack.includes(String(taste).toLowerCase())) ? 25 : 4;
}

function priceScore(price, budget) {
  if (!budget || price === null) return 12;
  if (price <= budget) return 20;
  if (price <= budget * 1.15) return 14;
  if (price <= budget * 1.3) return 6;
  return 0;
}

function distanceScore(distance, radius, fulfillment) {
  if (distance === null || !radius) return fulfillment === 'delivery' ? 5 : 4;
  const max = fulfillment === 'delivery' ? 5 : 10;
  return max * (1 - clamp(distance / radius, 0, 1));
}

function reviewScore(dish) {
  const rating = dish.currentRating || dish.reviewRating || dish.externalRating || 3.5;
  const confidence = Math.min(Math.log2(dish.reviewCount + 1) / 5, 1);
  return clamp(((rating - 2.5) / 2.5) * 14, 0, 14) + confidence * 6;
}

function evidenceScore(dish) {
  const count = Number(dish.recommendationCount || dish.reviewCount || 0);
  return Math.min(Math.log2(count + 1) / 4, 1) * 15;
}

function freshnessScore(updatedAt, now = new Date()) {
  if (!updatedAt) return 1;
  const ageDays = Math.max(0, (now - new Date(updatedAt)) / 86400000);
  if (ageDays <= 90) return 2;
  if (ageDays <= 365) return 1;
  return 0;
}

function completenessScore(dish) {
  const fields = [dish.name, dish.category || dish.cuisine, dish.price, dish.branchName, dish.address];
  return fields.filter(value => value !== null && value !== undefined && String(value).trim() !== '').length;
}

function illustrationFor(dish) {
  const text = `${dish.name} ${dish.category} ${dish.cuisine}`;
  const entries = [
    ['小面', 'noodles'], ['米线', 'rice-noodles'], ['米粉', 'rice-noodles'], ['饭', 'rice'],
    ['火锅', 'hotpot'], ['冒菜', 'malatang'], ['麻辣烫', 'malatang'], ['烧烤', 'bbq'],
    ['奶茶', 'drink'], ['咖啡', 'coffee'], ['甜品', 'dessert'], ['蛋糕', 'dessert'],
  ];
  const match = entries.find(([keyword]) => text.includes(keyword));
  return match ? match[1] : 'meal';
}

function scoreDish(dish, options) {
  const tastes = Array.isArray(options.tastes) ? options.tastes.filter(Boolean) : [];
  const scoreBreakdown = {
    price: priceScore(dish.price, options.budget),
    distance: distanceScore(dish.distance, options.radius, options.fulfillment),
    taste: preferenceScore(dish, tastes),
    review: reviewScore(dish),
    recommendationEvidence: evidenceScore(dish),
    completeness: completenessScore(dish),
    freshness: freshnessScore(dish.sourceUpdatedAt, options.now || new Date()),
    exploration: stableNoise(options.seed, dish.id) * 3,
  };
  const base = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const recommendationScore = Math.round(clamp(base, 0, 100) * 10) / 10;
  const reasons = [];
  if (options.budget && dish.price !== null && dish.price <= options.budget) reasons.push(`预算内 ¥${dish.price}`);
  if (dish.distance !== null) reasons.push(dish.distance < 1000 ? `约 ${Math.round(dish.distance)} 米` : `约 ${(dish.distance / 1000).toFixed(1)} 公里`);
  if (tastes.length && scoreBreakdown.taste >= 25) reasons.push('符合口味偏好');
  if (dish.reviewCount > 0) reasons.push(`${dish.reviewCount} 条真实评价`);
  if (!reasons.length) reasons.push('随机探索一家不同的小店');
  return {
    recommendationScore, scoreBreakdown, reasons: reasons.slice(0, 3),
    recommendationType: 'dish', dataTier: 'A', displayTitle: dish.name,
    visual: dish.image
      ? { kind: 'real_image', url: dish.image, label: '已审核菜品图' }
      : { kind: 'category_illustration', key: illustrationFor(dish), label: '分类示意图' },
  };
}

function recommendDishes(dishes, options = {}) {
  const mode = options.mode === 'surprise' ? 'surprise' : 'gallery';
  const limit = mode === 'surprise' ? 1 : clamp(Number(options.limit) || 20, 1, 40);
  const seed = String(options.seed || new Date().toISOString().slice(0, 10));
  const budget = Number(options.budget) || 0;
  const spiceLevels = Array.isArray(options.spiceLevels) ? options.spiceLevels.map(Number) : [];
  const excluded = new Set(options.excludeDishIds || []);

  const ranked = dishes
    .filter(dish => !excluded.has(dish.id))
    .filter(dish => !budget || dish.price === null || dish.price <= budget * 1.3)
    .filter(dish => !spiceLevels.length || dish.spiceLevel === null || spiceLevels.includes(dish.spiceLevel))
    .map(dish => ({ ...dish, ...scoreDish(dish, { ...options, budget, seed }) }))
    .sort((a, b) => b.recommendationScore - a.recommendationScore);

  // 每类最多连续取两道，防止推荐页被火锅或奶茶占满。
  const categoryCounts = new Map();
  const diverse = [];
  for (const dish of ranked) {
    const category = dish.category || dish.cuisine || '其他';
    const count = categoryCounts.get(category) || 0;
    if (count >= 2 && diverse.length < limit) continue;
    categoryCounts.set(category, count + 1);
    diverse.push(dish);
    if (diverse.length >= limit) break;
  }
  if (diverse.length < limit) {
    for (const dish of ranked) {
      if (!diverse.some(item => item.id === dish.id)) diverse.push(dish);
      if (diverse.length >= limit) break;
    }
  }
  return diverse;
}

module.exports = { recommendDishes, scoreDish, illustrationFor };
