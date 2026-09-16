const crypto = require('node:crypto');
const { protectApprovedUpdates } = require('./approvedCandidateGuard');

const ALLOWED_SOURCES = new Set(['amap', 'swu-official', 'manual', 'merchant-authorized']);

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableId(sourceId, name, address) {
  return `${sourceId}:${crypto.createHash('sha256').update(`${name}\n${address}`).digest('hex').slice(0, 24)}`;
}

function normalizeBranch(record, index = 0) {
  const sourceId = String(record.sourceId || (record.amapPoiId || record.merchantId ? 'amap' : 'manual')).trim();
  const name = String(record.canonicalName || record.name || '').trim();
  const address = String(record.address || '').trim();
  if (!ALLOWED_SOURCES.has(sourceId)) throw new Error(`第 ${index + 1} 条来源不允许`);
  if (!name) throw new Error(`第 ${index + 1} 条缺少商家/分店名称`);
  const amapPoi = String(record.amapPoiId || (sourceId === 'amap' ? record.merchantId || '' : '')).trim() || null;
  const id = String(record.branchId || amapPoi || '').trim() || stableId(sourceId, name, address);
  const aliases = Array.isArray(record.aliases)
    ? [...new Set(record.aliases.map(value => String(value).trim()).filter(Boolean))].slice(0, 50)
    : [];
  const lat = finiteOrNull(record.lat ?? record.latitude);
  const lng = finiteOrNull(record.lng ?? record.longitude);
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
    throw new Error(`第 ${index + 1} 条经纬度超出范围`);
  }
  return {
    id,
    merchantId: String(record.brandId || `merchant:${id}`),
    amapPoi,
    sourceId,
    externalId: String(record.externalId || amapPoi || id),
    name: name.slice(0, 200),
    aliases,
    address: address.slice(0, 500),
    area: String(record.area || '').trim().slice(0, 100),
    cuisine: String(record.cuisine || '').trim().slice(0, 200),
    lat,
    lng,
    phone: String(record.phone || '').trim().slice(0, 100),
    avgCost: finiteOrNull(record.avgCost ?? record.avg_cost),
    externalRating: finiteOrNull(record.externalRating ?? record.rating),
    evidenceUrl: String(record.evidenceUrl || '').trim(),
  };
}

function prepareBranches(payload) {
  const input = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(input)) throw new Error('商家文件必须是数组或包含 records 数组');
  const records = input.map(normalizeBranch);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`重复分店ID：${record.id}`);
    seen.add(record.id);
  }
  return records;
}

async function importBranches(client, records) {
  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const sourceRecordId = `${record.sourceId}:branch:${record.externalId}`;
    const safePayload = {
      name: record.name, aliases: record.aliases, address: record.address, area: record.area,
      cuisine: record.cuisine, lat: record.lat, lng: record.lng, phone: record.phone,
      avgCost: record.avgCost, externalRating: record.externalRating, amapPoi: record.amapPoi,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(safePayload)).digest('hex');
    const existing = await client.query('SELECT normalized_hash FROM source_records WHERE id=$1', [sourceRecordId]);
    await client.query(
      `INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload)
       VALUES($1,$2,$3,'branch',$4,$5,$6::jsonb)
       ON CONFLICT(id) DO UPDATE SET evidence_url=EXCLUDED.evidence_url,normalized_hash=EXCLUDED.normalized_hash,
         raw_payload=EXCLUDED.raw_payload,fetched_at=NOW()`,
      [sourceRecordId, record.sourceId, record.externalId, record.evidenceUrl, hash, JSON.stringify(safePayload)],
    );
    await client.query(
      `INSERT INTO merchants(id,canonical_name,aliases,review_status)
       VALUES($1,$2,$3::jsonb,'candidate')
       ON CONFLICT(id) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,aliases=EXCLUDED.aliases,updated_at=NOW()
       ${protectApprovedUpdates('merchants')}`,
      [record.merchantId, record.name, JSON.stringify(record.aliases)],
    );
    await client.query(
      `INSERT INTO branches(
         id,merchant_id,amap_poi,name,aliases,address,area,latitude,longitude,cuisine,phone,
         avg_cost,external_rating,review_status,primary_source_id,source_updated_at
       ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,'candidate',$14,NOW())
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,aliases=EXCLUDED.aliases,address=EXCLUDED.address,
         area=EXCLUDED.area,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,cuisine=EXCLUDED.cuisine,
         phone=EXCLUDED.phone,avg_cost=EXCLUDED.avg_cost,external_rating=EXCLUDED.external_rating,
         source_updated_at=NOW(),updated_at=NOW()
       ${protectApprovedUpdates('branches')}`,
      [
        record.id, record.merchantId, record.amapPoi, record.name, JSON.stringify(record.aliases),
        record.address, record.area, record.lat, record.lng, record.cuisine, record.phone,
        record.avgCost, record.externalRating, record.sourceId,
      ],
    );
    await client.query(
      `INSERT INTO branch_source_links(branch_id,source_record_id,match_method,match_confidence)
       VALUES($1,$2,'external_id',100) ON CONFLICT DO NOTHING`,
      [record.id, sourceRecordId],
    );
    if (!existing.rows[0]) inserted += 1;
    else if (existing.rows[0].normalized_hash !== hash) updated += 1;
  }
  return { total: records.length, inserted, updated };
}

module.exports = { normalizeBranch, prepareBranches, importBranches };
