const crypto = require('node:crypto');

function cleanDate(value) {
  const text = String(value || '').trim().replaceAll('/', '-');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}

function normalizeLicense(record, index = 0) {
  const legalName = String(record.legalName || record.name || '').trim();
  const address = String(record.address || record.businessAddress || '').trim();
  if (!legalName || !address) throw new Error(`第 ${index + 1} 条许可记录缺少名称或经营地址`);
  const stable = `${legalName}\n${address}\n${record.issuedOn || ''}`;
  const externalId = String(record.externalId || record.licenseNumber || '').trim()
    || crypto.createHash('sha256').update(stable).digest('hex');
  return {
    externalId,
    legalName,
    address,
    businessScope: String(record.businessScope || record.scope || '').trim(),
    issuedOn: cleanDate(record.issuedOn),
    validUntil: cleanDate(record.validUntil),
    licenseStatus: String(record.licenseStatus || record.status || '').trim(),
    evidenceUrl: String(record.evidenceUrl || '').trim(),
  };
}

function prepareLicenses(payload) {
  const input = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(input)) throw new Error('许可文件必须是数组或包含 records 数组');
  const records = input.map(normalizeLicense);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.externalId)) throw new Error(`重复许可记录：${record.externalId}`);
    seen.add(record.externalId);
  }
  return records;
}

async function importLicenses(client, records) {
  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const sourceRecordId = `cq-license:${record.externalId}`;
    const safePayload = {
      legalName: record.legalName,
      address: record.address,
      businessScope: record.businessScope,
      issuedOn: record.issuedOn,
      validUntil: record.validUntil,
      licenseStatus: record.licenseStatus,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(safePayload)).digest('hex');
    const existing = await client.query('SELECT normalized_hash FROM source_records WHERE id=$1', [sourceRecordId]);
    await client.query(
      `INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload)
       VALUES($1,'cq-beibei-food-license',$2,'license',$3,$4,$5::jsonb)
       ON CONFLICT(id) DO UPDATE SET evidence_url=EXCLUDED.evidence_url,normalized_hash=EXCLUDED.normalized_hash,
         raw_payload=EXCLUDED.raw_payload,fetched_at=NOW()`,
      [sourceRecordId, record.externalId, record.evidenceUrl, hash, JSON.stringify(safePayload)],
    );
    await client.query(
      `INSERT INTO food_licenses(id,source_record_id,legal_name,business_address,business_scope,issued_on,valid_until,license_status)
       VALUES($1,$1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET legal_name=EXCLUDED.legal_name,business_address=EXCLUDED.business_address,
         business_scope=EXCLUDED.business_scope,issued_on=EXCLUDED.issued_on,valid_until=EXCLUDED.valid_until,
         license_status=EXCLUDED.license_status,updated_at=NOW()`,
      [sourceRecordId, record.legalName, record.address, record.businessScope, record.issuedOn, record.validUntil, record.licenseStatus],
    );
    if (!existing.rows[0]) inserted += 1;
    else if (existing.rows[0].normalized_hash !== hash) updated += 1;
  }
  return { inserted, updated, total: records.length };
}

module.exports = { cleanDate, normalizeLicense, prepareLicenses, importLicenses };
