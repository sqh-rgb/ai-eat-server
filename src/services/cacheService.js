/**
 * 内存缓存 — 同条件推荐 30 分钟内不重复请求高德 API
 */

const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 1800; // 默认 30 分钟
const store = new Map();

/** 生成缓存键 */
function makeKey(lat, lng, budget, radius, taste) {
  const roundedLat = Math.round(lat * 1000) / 1000; // 3 位小数精度
  const roundedLng = Math.round(lng * 1000) / 1000;
  return `rec:${roundedLat}:${roundedLng}:${budget}:${radius}:${taste}`;
}

/** 读取缓存 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL * 1000) {
    store.delete(key);
    return null;
  }
  console.log(`[Cache] HIT → ${key}`);
  return entry.data;
}

/** 写入缓存 */
function set(key, data) {
  store.set(key, { data, time: Date.now() });
  console.log(`[Cache] SET → ${key} (${store.size} entries)`);
}

/** 定时清理过期条目 */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.time > CACHE_TTL * 1000) store.delete(key);
  }
}, 300000); // 每 5 分钟清理一次
cleanupTimer.unref?.();

module.exports = { get, set, makeKey };
