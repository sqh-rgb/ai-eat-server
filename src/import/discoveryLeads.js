const crypto = require('node:crypto');

const PLATFORMS = new Set(['dianping', 'douyin', 'xiaohongshu', 'bilibili', 'merchant_page', 'manual']);

function normalizeLead(record, index = 0) {
  const platform = String(record.platform || '').trim().toLowerCase();
  const candidateName = String(record.candidateName || record.name || '').trim();
  const evidenceUrl = String(record.evidenceUrl || record.url || '').trim();
  if (!PLATFORMS.has(platform)) throw new Error(`第 ${index + 1} 条平台类型无效`);
  if (!candidateName || !/^https:\/\//i.test(evidenceUrl)) throw new Error(`第 ${index + 1} 条缺少候选名称或 HTTPS 证据链接`);
  const dishes = Array.isArray(record.dishes)
    ? [...new Set(record.dishes.map(value => String(value).trim()).filter(value => value.length >= 2))].slice(0, 30)
    : [];
  const observedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(record.observedAt || '')) ? record.observedAt : null;
  const externalId = crypto.createHash('sha256').update(`${platform}\n${evidenceUrl}`).digest('hex');
  return { externalId, platform, candidateName: candidateName.slice(0, 200), dishes, evidenceUrl, observedAt };
}

function prepareLeads(payload) {
  const input = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(input)) throw new Error('线索文件必须是数组或包含 records 数组');
  return input.map(normalizeLead);
}

async function importLeads(client, records) {
  let inserted = 0;
  for (const record of records) {
    const sourceRecordId = `social:${record.externalId}`;
    const safePayload = {
      platform: record.platform,
      candidateName: record.candidateName,
      dishes: record.dishes,
      observedAt: record.observedAt,
    };
    const normalizedHash = crypto.createHash('sha256').update(JSON.stringify(safePayload)).digest('hex');
    const existing = await client.query('SELECT 1 FROM source_records WHERE id=$1', [sourceRecordId]);
    await client.query(
      `INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload)
       VALUES($1,'social-discovery',$2,'discovery',$3,$4,$5::jsonb)
       ON CONFLICT(id) DO UPDATE SET evidence_url=EXCLUDED.evidence_url,normalized_hash=EXCLUDED.normalized_hash,
         raw_payload=EXCLUDED.raw_payload,fetched_at=NOW()`,
      [sourceRecordId, record.externalId, record.evidenceUrl, normalizedHash, JSON.stringify(safePayload)],
    );
    await client.query(
      `INSERT INTO discovery_leads(id,source_record_id,platform,candidate_name,candidate_dishes,evidence_url,observed_at)
       VALUES($1,$1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT(id) DO UPDATE SET candidate_name=EXCLUDED.candidate_name,candidate_dishes=EXCLUDED.candidate_dishes,
         evidence_url=EXCLUDED.evidence_url,observed_at=EXCLUDED.observed_at,updated_at=NOW()`,
      [sourceRecordId, record.platform, record.candidateName, JSON.stringify(record.dishes), record.evidenceUrl, record.observedAt],
    );
    if (!existing.rows[0]) inserted += 1;
  }
  return { total: records.length, inserted, updated: records.length - inserted };
}

module.exports = { normalizeLead, prepareLeads, importLeads };
