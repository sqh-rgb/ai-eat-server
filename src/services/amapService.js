/**
 * 高德地图 Web API 封装
 *
 * 免费额度：周边搜索 5000 次/日 · POI 详情 3000 次/日
 */

const AMAP_KEY = process.env.AMAP_KEY || '';
const BASE = 'https://restapi.amap.com/v3';

/**
 * 周边搜索 — 获取附近餐厅列表
 * @param {number} lat 纬度
 * @param {number} lng 经度
 * @param {number} radius 搜索半径（米）
 * @param {number} offset 返回数量
 * @returns {Array} 餐厅 POI 列表
 */
async function searchNearby(lat, lng, radius = 3000, offset = 25) {
  const url = `${BASE}/place/around?key=${AMAP_KEY}&location=${lng},${lat}&radius=${radius}&types=050000&offset=${offset}&page=1`;

  console.log(`[Amap] 周边搜索 → location=${lng},${lat} radius=${radius}`);

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== '1' || !data.pois) {
    console.warn('[Amap] 周边搜索失败:', data.info);
    return [];
  }

  return data.pois.map(p => ({
    amap_poi: p.id,
    name: p.name,
    address: p.address,
    lat: parseFloat(p.location.split(',')[1]),
    lng: parseFloat(p.location.split(',')[0]),
    distance: parseInt(p.distance),
    avg_cost: p.biz_ext?.cost ? parseInt(p.biz_ext.cost) : null,
    rating: parseFloat(p.biz_ext?.rating) || p.rating ? parseFloat(p.rating) : 3,
    cuisine: p.type ? mapCuisine(p.type) : '其他',
    photos: p.photos?.map(ph => ph.url) || []
  }));
}

/**
 * POI 详情 — 获取营业时间、电话等
 */
async function getDetail(poiId) {
  const url = `${BASE}/place/detail?key=${AMAP_KEY}&id=${poiId}`;

  console.log(`[Amap] POI 详情 → id=${poiId}`);

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== '1' || !data.pois || data.pois.length === 0) {
    return null;
  }

  const p = data.pois[0];
  return {
    phone: p.tel || null,
    hours: p.business_area || p.opentime || null,
    photos: p.photos?.map(ph => ph.url) || []
  };
}

/** 高德 type 标签 → 菜系中文名 */
function mapCuisine(typeTag) {
  const match = typeTag?.match(/中餐厅;([^;]+)/);
  return match ? match[1] : '其他';
}

module.exports = { searchNearby, getDetail };
