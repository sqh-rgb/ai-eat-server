const crypto = require('node:crypto');
const { recommendDishes } = require('./dishRecommendationEngine');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableNoise(seed, id) {
  const digest = crypto.createHash('sha256').update(`${seed}:${id}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

const CATEGORIES = [
  { label: '小面', key: 'noodles', words: ['小面', '面馆', '面庄', '面食'] },
  { label: '米线米粉', key: 'rice-noodles', words: ['米线', '米粉', '酸辣粉', '粉店'] },
  { label: '盖饭炒饭', key: 'rice', words: ['盖饭', '炒饭', '快餐', '便当', '食堂'] },
  { label: '冒菜麻辣烫', key: 'malatang', words: ['冒菜', '麻辣烫', '串串'] },
  { label: '烧烤', key: 'bbq', words: ['烧烤', '烤肉', '烤串'] },
  { label: '火锅', key: 'hotpot', words: ['火锅'] },
  { label: '早餐小吃', key: 'snack', words: ['早餐', '小吃', '包子', '饺子', '抄手', '馄饨', '粥'] },
  { label: '奶茶饮品', key: 'drink', words: ['奶茶', '饮品', '茶饮', '果茶'] },
  { label: '咖啡', key: 'coffee', words: ['咖啡'] },
  { label: '甜品蛋糕', key: 'dessert', words: ['甜品', '蛋糕', '糕点', '烘焙'] },
];

function inferFoodCategory(branch) {
  const text = `${branch.name || ''} ${branch.cuisine || ''}`;
  return CATEGORIES.find(category => category.words.some(word => text.includes(word))) || null;
}

function priceScore(cost, budget) {
  if (!budget || cost === null) return 15;
  if (cost <= budget) return 25;
  if (cost <= budget * 1.15) return 17;
  if (cost <= budget * 1.3) return 7;
  return 0;
}

function tasteScore(branch, category, tastes) {
  if (!tastes.length) return 18;
  const text = `${branch.name} ${branch.cuisine} ${category.label}`.toLowerCase();
  return tastes.some(taste => text.includes(String(taste).toLowerCase())) ? 30 : 5;
}

function ratingScore(branch) {
  const rating = branch.currentRating || branch.reviewRating || branch.externalRating;
  if (!rating) return 8;
  const quality = clamp((rating - 2.5) / 2.5, 0, 1) * 15;
  const confidence = Math.min(Math.log2(Number(branch.reviewCount || 0) + 1) / 5, 1) * 5;
  return quality + confidence;
}

function recommendationEvidenceScore(branch) {
  const mentions = Number(branch.recommendationCount || 0);
  const dishes = Number(branch.dishCount || 0);
  return Math.min(Math.log2(mentions + dishes + 1) / 5, 1) * 15;
}

function completenessScore(branch) {
  const fields = [branch.name, branch.cuisine, branch.avgCost, branch.address,
    branch.lat !== null && branch.lng !== null ? 'location' : ''];
  return fields.filter(value => value !== null && value !== undefined && String(value).trim() !== '').length;
}

function freshnessScore(updatedAt, now) {
  if (!updatedAt) return 5;
  const days = Math.max(0, (now - new Date(updatedAt)) / 86400000);
  if (days <= 30) return 10;
  if (days <= 90) return 8;
  if (days <= 180) return 6;
  if (days <= 365) return 3;
  return 0;
}

function distanceScore(distance, radius, fulfillment) {
  if (distance === null || !radius) return fulfillment === 'delivery' ? 7 : 6;
  const max = fulfillment === 'delivery' ? 7 : 10;
  return max * (1 - clamp(distance / radius, 0, 1));
}

function scoreFoodCategory(branch, options) {
  const category = inferFoodCategory(branch);
  if (!category) return null;
  const tastes = Array.isArray(options.tastes) ? options.tastes : [];
  const breakdown = {
    taste: tasteScore(branch, category, tastes) * (25 / 30),
    price: priceScore(branch.avgCost, options.budget) * (20 / 25),
    review: ratingScore(branch),
    recommendationEvidence: recommendationEvidenceScore(branch),
    completeness: completenessScore(branch),
    freshness: freshnessScore(branch.sourceUpdatedAt, options.now || new Date()) * 0.5,
    distance: distanceScore(branch.distance, options.radius, options.fulfillment),
    exploration: stableNoise(options.seed, branch.id) * 5,
  };
  const score = Math.round(clamp(Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100) * 10) / 10;
  const reasons = [];
  if (branch.avgCost !== null && options.budget && branch.avgCost <= options.budget) reasons.push(`人均约 ¥${branch.avgCost}，预算内`);
  if (branch.reviewCount > 0) reasons.push(`${branch.reviewCount} 条真实评价`);
  if (branch.distance !== null) reasons.push(branch.distance < 1000 ? `约 ${Math.round(branch.distance)} 米` : `约 ${(branch.distance / 1000).toFixed(1)} 公里`);
  if (!reasons.length) reasons.push('符合当前食物类型');
  return {
    ...branch,
    recommendationType: 'food_category',
    dataTier: 'B',
    displayTitle: `今天吃${category.label}`,
    foodCategory: category.label,
    menuVerified: false,
    recommendationScore: score,
    scoreBreakdown: breakdown,
    reasons: reasons.slice(0, 3),
    visual: { kind: 'category_illustration', key: category.key, label: '分类示意图' },
  };
}

function recommendFoodCategories(branches, options = {}) {
  const excluded = new Set(options.excludeBranchIds || []);
  const limit = clamp(Number(options.limit) || 20, 1, 40);
  const ranked = branches
    .filter(branch => !excluded.has(branch.id))
    .filter(branch => !options.budget || branch.avgCost === null || branch.avgCost <= options.budget * 1.3)
    .map(branch => scoreFoodCategory(branch, options))
    .filter(Boolean)
    .sort((a, b) => b.recommendationScore - a.recommendationScore);
  const counts = new Map();
  const result = [];
  for (const item of ranked) {
    const count = counts.get(item.foodCategory) || 0;
    if (count >= 2) continue;
    counts.set(item.foodCategory, count + 1);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function recommendHybrid({ dishes = [], branches = [] }, options = {}) {
  const mode = options.mode === 'surprise' ? 'surprise' : 'gallery';
  const limit = mode === 'surprise' ? 1 : clamp(Number(options.limit) || 20, 1, 40);
  const dishItems = recommendDishes(dishes, { ...options, mode: 'gallery', limit: Math.max(limit, 20) });
  const dishBranchIds = new Set(dishItems.map(item => item.branchId));
  const categoryItems = recommendFoodCategories(
    branches.filter(branch => !dishBranchIds.has(branch.id)),
    { ...options, limit: Math.max(limit, 20) },
  );
  if (mode === 'surprise') {
    if (!dishItems.length) return categoryItems.slice(0, 1);
    if (!categoryItems.length) return dishItems.slice(0, 1);
    return stableNoise(options.seed, 'track-choice') < 0.7 ? dishItems.slice(0, 1) : categoryItems.slice(0, 1);
  }
  const dishTarget = Math.min(dishItems.length, Math.ceil(limit * 0.7));
  const result = [...dishItems.slice(0, dishTarget), ...categoryItems.slice(0, limit - dishTarget)];
  for (const item of [...dishItems.slice(dishTarget), ...categoryItems.slice(limit - dishTarget)]) {
    if (result.length >= limit) break;
    if (!result.some(existing => existing.recommendationType === item.recommendationType && existing.id === item.id)) result.push(item);
  }
  return result;
}

module.exports = { inferFoodCategory, scoreFoodCategory, recommendFoodCategories, recommendHybrid };
