const crypto = require('node:crypto');

const ALLOWED_SOURCES = new Set(['amap', 'swu-official', 'social-discovery', 'qq-channel', 'manual', 'merchant-authorized']);

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDish(record, index = 0) {
  const branchId = String(record.branchId || record.amapPoiId || '').trim();
  const name = String(record.name || record.dishName || '').trim();
  const sourceId = String(record.sourceId || 'manual').trim();
  if (!branchId || name.length < 2) throw new Error(`第 ${index + 1} 条菜品缺少分店或有效名称`);
  if (!ALLOWED_SOURCES.has(sourceId)) throw new Error(`第 ${index + 1} 条菜品来源不允许`);
  const price = finiteOrNull(record.price);
  const spiceLevel = finiteOrNull(record.spiceLevel);
  if (price !== null && (price < 0 || price > 5000)) throw new Error(`第 ${index + 1} 条价格异常`);
  if (spiceLevel !== null && ![0, 1, 2, 3, 4].includes(spiceLevel)) throw new Error(`第 ${index + 1} 条辣度必须为0～4`);
  const id = String(record.id || '').trim() || `dish:${crypto.createHash('sha256').update(`${branchId}\n${name}`).digest('hex').slice(0, 24)}`;
  return {
    id, branchId, name: name.slice(0, 200), sourceId,
    aliases: Array.isArray(record.aliases) ? [...new Set(record.aliases.map(String).map(value => value.trim()).filter(Boolean))] : [],
    category: String(record.category || '').trim().slice(0, 100),
    price, spiceLevel,
    suitableSolo: typeof record.suitableSolo === 'boolean' ? record.suitableSolo : null,
    evidenceUrl: String(record.evidenceUrl || '').trim(),
  };
}

function prepareDishes(payload) {
  const input = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(input)) throw new Error('菜品文件必须是数组或包含 records 数组');
  const records = input.map(normalizeDish);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`重复菜品ID：${record.id}`);
    seen.add(record.id);
  }
  return records;
}

async function importDishes(client, records) {
  if (records.length === 0) return { total: 0, inserted: 0, updated: 0 };
  const branchIds = [...new Set(records.map(record => record.branchId))];
  const placeholders = branchIds.map((_, index) => `$${index + 1}`).join(',');
  const found = await client.query(`SELECT id FROM branches WHERE id IN (${placeholders})`, branchIds);
  const valid = new Set(found.rows.map(row => row.id));
  const missing = branchIds.filter(id => !valid.has(id));
  if (missing.length) throw new Error(`菜品引用了不存在的分店：${missing.slice(0, 10).join(', ')}`);

  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const externalId = `${record.branchId}:${record.name}`;
    const sourceRecordId = `${record.sourceId}:dish:${crypto.createHash('sha256').update(externalId).digest('hex')}`;
    const safePayload = {
      branchId: record.branchId, name: record.name, aliases: record.aliases, category: record.category,
      price: record.price, spiceLevel: record.spiceLevel, suitableSolo: record.suitableSolo,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(safePayload)).digest('hex');
    const existing = await client.query('SELECT normalized_hash FROM source_records WHERE id=$1', [sourceRecordId]);
    await client.query(
      `INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload)
       VALUES($1,$2,$3,'dish',$4,$5,$6::jsonb)
       ON CONFLICT(id) DO UPDATE SET evidence_url=EXCLUDED.evidence_url,normalized_hash=EXCLUDED.normalized_hash,
         raw_payload=EXCLUDED.raw_payload,fetched_at=NOW()`,
      [sourceRecordId, record.sourceId, externalId, record.evidenceUrl, hash, JSON.stringify(safePayload)],
    );
    await client.query(
      `INSERT INTO dishes(id,branch_id,name,aliases,category,price,spice_level,suitable_solo,review_status,primary_source_id)
       VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,'candidate',$9)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,aliases=EXCLUDED.aliases,category=EXCLUDED.category,
         price=EXCLUDED.price,spice_level=EXCLUDED.spice_level,suitable_solo=EXCLUDED.suitable_solo,updated_at=NOW()`,
      [record.id, record.branchId, record.name, JSON.stringify(record.aliases), record.category, record.price, record.spiceLevel, record.suitableSolo, record.sourceId],
    );
    if (!existing.rows[0]) inserted += 1;
    else if (existing.rows[0].normalized_hash !== hash) updated += 1;
  }
  return { total: records.length, inserted, updated };
}

module.exports = { normalizeDish, prepareDishes, importDishes };
