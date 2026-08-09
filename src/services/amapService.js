const AMAP_KEY = process.env.AMAP_KEY || '';
const BASE = 'https://restapi.amap.com/v3';

function mapCuisine(typeTag) {
  const match = typeTag?.match(/中餐厅;([^;]+)/);
  return match ? match[1] : '其他';
}

async function searchNearby(lat, lng, radius = 3000, offset = 50) {
  const url = `${BASE}/place/around?key=${AMAP_KEY}&location=${lng},${lat}&radius=${radius}&types=050000&offset=${offset}&page=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== '1' || !data.pois) return [];
  return data.pois.map(p => ({
    amap_poi: p.id, name: p.name, address: p.address,
    lat: parseFloat(p.location.split(',')[1]), lng: parseFloat(p.location.split(',')[0]),
    distance: parseInt(p.distance),
    avg_cost: p.biz_ext?.cost ? parseInt(p.biz_ext.cost) : null,
    rating: p.biz_ext?.rating ? parseFloat(p.biz_ext.rating) : null,
    cuisine: p.type ? mapCuisine(p.type) : '其他',
    photos: p.photos?.map(ph => ph.url) || []
  }));
}

async function getDetail(poiId) {
  const url = `${BASE}/place/detail?key=${AMAP_KEY}&id=${poiId}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== '1' || !data.pois || data.pois.length === 0) return null;
  const p = data.pois[0];
  return { phone: p.tel || null, hours: p.business_area || p.opentime || null, photos: p.photos?.map(ph => ph.url) || [] };
}

async function geocode(address) {
  const url = `${BASE}/geocode/geo?key=${AMAP_KEY}&address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) return null;
  const loc = data.geocodes[0].location.split(',');
  return { lat: parseFloat(loc[1]), lng: parseFloat(loc[0]), formatted: data.geocodes[0].formatted_address };
}

module.exports = { searchNearby, getDetail, geocode };
