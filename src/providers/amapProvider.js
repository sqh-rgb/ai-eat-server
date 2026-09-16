const BASE_URL = 'https://restapi.amap.com/v5/place/around';

function normalizePoi(poi) {
  const [lng, lat] = String(poi.location || ',').split(',').map(Number);
  const business = poi.business || {};
  return {
    externalId: String(poi.id || '').trim(),
    name: String(poi.name || '').trim(),
    alias: String(business.alias || '').trim(),
    address: Array.isArray(poi.address) ? poi.address.join('') : String(poi.address || ''),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    type: String(poi.type || ''),
    typecode: String(poi.typecode || ''),
    businessArea: String(business.business_area || ''),
    phone: String(business.tel || ''),
    rating: business.rating === undefined || business.rating === '' ? null : Number(business.rating),
    cost: business.cost === undefined || business.cost === '' ? null : Number(business.cost),
    photos: Array.isArray(poi.photos) ? poi.photos.map(photo => ({ title: photo.title || '', url: photo.url || '' })) : [],
    raw: poi,
  };
}

async function fetchAround({ key, lat, lng, radius, keywords = '', types = '050000', page = 1, pageSize = 25, signal }) {
  if (!key) throw new Error('AMAP_KEY 尚未配置');
  const url = new URL(BASE_URL);
  url.searchParams.set('key', key);
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('radius', String(radius));
  url.searchParams.set('types', types);
  url.searchParams.set('page_num', String(page));
  url.searchParams.set('page_size', String(Math.min(Math.max(pageSize, 1), 25)));
  url.searchParams.set('show_fields', 'business,photos');
  if (keywords) url.searchParams.set('keywords', keywords);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`高德地点搜索返回 HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== '1') {
    const info = payload.info || payload.infocode || '未知错误';
    const error = new Error(`高德地点搜索失败：${info}`);
    error.code = String(info);
    throw error;
  }
  const pois = Array.isArray(payload.pois) ? payload.pois.map(normalizePoi).filter(item => item.externalId && item.name) : [];
  return { pois, count: Number(payload.count || 0), requestUrl: url.toString().replace(key, '[REDACTED]') };
}

function sleep(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function isRetryable(error) {
  return error?.name === 'AbortError'
    || /CUQPS|QPS|SERVICE_NOT_AVAILABLE|UNKNOWN_ERROR|HTTP 429|HTTP 5\d\d/.test(String(error?.code || error?.message || ''));
}

async function requestWithRetry(params, options = {}) {
  const fetchPage = options.fetchPage || fetchAround;
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 6;
  const retryBaseMs = Number.isFinite(options.retryBaseMs) ? options.retryBaseMs : 2500;
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await fetchPage({ ...params, signal: controller.signal });
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries) throw error;
      const waitMs = retryBaseMs * (attempt + 1);
      options.onRetry?.({ attempt: attempt + 1, waitMs, error });
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function collectPois(config, options = {}) {
  const key = options.key || process.env.AMAP_KEY;
  const maxPages = Math.min(Math.max(Number(config.maxPages) || 8, 1), 40);
  const pageSize = Math.min(Math.max(Number(config.pageSize) || 25, 1), 25);
  const parsedDelay = Number(config.delayMs);
  const delayMs = Number.isFinite(parsedDelay) ? Math.max(parsedDelay, 0) : 1000;
  const byId = new Map();
  const evidence = new Map();
  let requests = 0;

  outer: for (const point of config.points || []) {
    for (const keyword of config.keywords || ['']) {
      const pageLimit = keyword ? Math.min(maxPages, Number(config.keywordMaxPages) || 2) : maxPages;
      for (let page = 1; page <= pageLimit; page += 1) {
        const result = await requestWithRetry({
          key, lat: point.lat, lng: point.lng, radius: point.radius || config.radius || 2500,
          keywords: keyword, types: config.types || '050000', page, pageSize,
        }, {
          fetchPage: options.fetchPage,
          maxRetries: options.maxRetries,
          retryBaseMs: options.retryBaseMs,
          onRetry: options.onRetry,
        });
        requests += 1;
        const pageEvidence = new Map();
        for (const poi of result.pois) {
          byId.set(poi.externalId, poi);
          const itemEvidence = { area: point.label || '', keyword, requestUrl: result.requestUrl };
          evidence.set(poi.externalId, itemEvidence);
          pageEvidence.set(poi.externalId, itemEvidence);
        }
        await options.onPage?.({ pois: result.pois, evidence: pageEvidence, requests, uniqueCount: byId.size, point, keyword, page });
        const pageFinished = result.pois.length < pageSize;
        const reachedLimit = byId.size >= (config.maxPois || 5000);
        await sleep(delayMs);
        if (reachedLimit) break outer;
        if (pageFinished) break;
      }
    }
  }
  return { pois: [...byId.values()], evidence, requests };
}

module.exports = { normalizePoi, fetchAround, requestWithRetry, collectPois };
