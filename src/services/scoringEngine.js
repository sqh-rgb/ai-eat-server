const CUISINE_SPICY = {
  '川菜':'spicy','湘菜':'spicy','江西菜':'spicy','重庆菜':'spicy',
  '粤菜':'mild','苏菜':'mild','浙菜':'mild','闽菜':'mild','本帮菜':'mild',
  '东北菜':'neutral','西北菜':'neutral','日韩料理':'neutral',
  '面食':'neutral','小吃快餐':'neutral','火锅':'spicy'
};

function scoreDistance(d) {
  if (d<=500) return 10; if (d<=1000) return 8; if (d<=2000) return 5; if (d<=3000) return 3; return 1;
}

function scoreBudget(cost, budget) {
  if (!cost||cost<=0) return 5;
  if (cost<=budget) return 10;
  if (cost<=budget*1.3) return 5;
  if (cost<=budget*1.5) return 2;
  return 0;
}

function scoreTaste(cuisine, userTaste) {
  if (userTaste==='any') return 5;
  const level = CUISINE_SPICY[cuisine]||'unknown';
  if (level==='unknown') return 5;
  const map = { nospicy:'mild', mild:'neutral' };
  const want = map[userTaste]||userTaste;
  if (want==='any') return 5;
  if (level===want) return 10;
  if (level==='neutral'||want==='neutral') return 5;
  return 0;
}

function scoreRating(amapRating, userRating) {
  const a = (amapRating||3)*2;
  if (!userRating) return a;
  return a*0.5 + userRating*2*0.5;
}

function scorePersonal(cuisine, prefs) {
  if (!prefs||prefs.length===0) return 0;
  if (prefs.includes(cuisine)) return 10;
  const lev = CUISINE_SPICY[cuisine]||'unknown';
  return prefs.some(c=>CUISINE_SPICY[c]&&CUISINE_SPICY[c]===lev) ? 5 : 0;
}

function scoreAll(restaurants, { budget, taste, userRatingMap, userPrefCuisines }) {
  const ur = userRatingMap||{}, pc = userPrefCuisines||[];
  return restaurants.map(r => {
    const D=scoreDistance(r.distance), P=scoreBudget(r.avg_cost,budget), T=scoreTaste(r.cuisine,taste), R=scoreRating(r.rating,ur[r.id]), E=scorePersonal(r.cuisine,pc);
    return { ...r, score: Math.round((0.25*D+0.30*P+0.20*T+0.15*R+0.10*E)*10)/10, dimensions:{D,P,T,R,E} };
  });
}

function rankAndFilter(scored, opts={}) {
  const { topN=5, minScore=1 } = opts;
  const ok = scored.filter(s=>s.score>=minScore);
  return ok.sort((a,b)=>(b.score+Math.random()*0.05)-(a.score+Math.random()*0.05)).slice(0,topN);
}

module.exports = { scoreAll, rankAndFilter };
