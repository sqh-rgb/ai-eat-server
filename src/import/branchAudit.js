const crypto = require('node:crypto');

function prepareAuditPackage(text) {
  let parsed;
  try { parsed = JSON.parse(String(text || '')); } catch { throw new Error('审核包不是有效 JSON'); }
  if (!parsed || !Array.isArray(parsed.records) || !parsed.records.length || parsed.records.length > 5000) {
    throw new Error('审核包必须包含 1～5000 条 records');
  }
  const seen = new Set();
  const records = parsed.records.map((record, index) => {
    const poiId = String(record.poiId || '').trim();
    const decision = String(record.decision || '').trim();
    const confirmedName = String(record.confirmedName || '').trim();
    const auditNote = String(record.auditNote || '').trim();
    const entityKind = String(record.entityKind || '').trim();
    const venueId = String(record.venueId || '').trim() || null;
    const locationDetail = String(record.locationDetail || '').trim();
    const existenceStatus = String(record.existenceStatus || '').trim();
    const verificationMethod = String(record.verificationMethod || '').trim();
    const verificationConfidence = Number(record.verificationConfidence);
    const verifiedAt = String(record.verifiedAt || '').trim() || null;
    const reverifyAfter = String(record.reverifyAfter || '').trim() || null;
    const verificationEvidenceUrl = String(record.verificationEvidenceUrl || '').trim();
    const verificationNote = String(record.verificationNote || '').trim();
    if (!poiId || poiId.length > 100) throw new Error(`第 ${index + 1} 条 POI ID 无效`);
    if (seen.has(poiId)) throw new Error(`审核包包含重复 POI ID：${poiId}`);
    seen.add(poiId);
    if (!['approved', 'rejected'].includes(decision)) throw new Error(`第 ${index + 1} 条审核决定无效`);
    if (!confirmedName || confirmedName.length > 200) throw new Error(`第 ${index + 1} 条确认名称无效`);
    if (typeof record.studentSuitable !== 'boolean') throw new Error(`第 ${index + 1} 条缺少学生适用结论`);
    if (auditNote.length > 500) throw new Error(`第 ${index + 1} 条审核备注过长`);
    if (!['standalone_store','stall','canteen_counter','mobile_vendor','unknown'].includes(entityKind)) {
      throw new Error(`第 ${index + 1} 条经营点类型无效`);
    }
    if (!['unverified','confirmed','uncertain','suspected_closed','temporarily_closed','permanently_closed'].includes(existenceStatus)) {
      throw new Error(`第 ${index + 1} 条存续状态无效`);
    }
    if (!['none','map','official','merchant','onsite','multi_source'].includes(verificationMethod)) {
      throw new Error(`第 ${index + 1} 条核实方式无效`);
    }
    if (!Number.isInteger(verificationConfidence) || verificationConfidence < 0 || verificationConfidence > 100) {
      throw new Error(`第 ${index + 1} 条核实可信度无效`);
    }
    if (decision === 'approved' && (existenceStatus !== 'confirmed' || verificationMethod === 'none' ||
        verificationConfidence < 60 || !verifiedAt || (!verificationEvidenceUrl && !verificationNote))) {
      throw new Error(`第 ${index + 1} 条批准商家必须有已确认营业状态、核实时间、证据和至少 60 的可信度`);
    }
    if (['stall','canteen_counter'].includes(entityKind) && !venueId) {
      throw new Error(`第 ${index + 1} 条档口必须填写所属美食街或食堂 venueId`);
    }
    return {
      poiId, decision, confirmedName, studentSuitable: record.studentSuitable, auditNote,
      entityKind, venueId, locationDetail, existenceStatus, verificationMethod,
      verificationConfidence, verifiedAt, reverifyAfter, verificationEvidenceUrl, verificationNote,
    };
  });
  const sha256 = crypto.createHash('sha256').update(String(text)).digest('hex');
  return {
    records,
    sha256,
    batchId: `branch-audit-${sha256.slice(0, 24)}`,
    sourceFilename: String(parsed.sourceWorkbook || 'branch-audit.json').slice(0, 300),
  };
}

async function previewAudit(client, batch) {
  const poiIds = batch.records.map(record => record.poiId);
  const result = await client.query(
    `SELECT id,amap_poi,name,review_status,COALESCE(NULLIF(amap_poi,''),id) AS audit_key
     FROM branches WHERE COALESCE(NULLIF(amap_poi,''),id)=ANY($1::text[]) ORDER BY audit_key`,
    [poiIds],
  );
  const found = new Set(result.rows.map(row => row.audit_key));
  const missing = poiIds.filter(id => !found.has(id));
  const venueIds = [...new Set(batch.records.map(record => record.venueId).filter(Boolean))];
  const venueResult = venueIds.length
    ? await client.query('SELECT id FROM venues WHERE id=ANY($1::text[])', [venueIds])
    : { rows: [] };
  const foundVenues = new Set(venueResult.rows.map(row => row.id));
  const missingVenues = venueIds.filter(id => !foundVenues.has(id));
  const counts = batch.records.reduce((summary, record) => {
    summary[record.decision] = (summary[record.decision] || 0) + 1;
    return summary;
  }, {});
  return { total: batch.records.length, matched: result.rows.length, missing, missingVenues, counts };
}

async function importAudit(client, batch) {
  const prior = await client.query('SELECT id,status,imported_count FROM branch_audit_batches WHERE content_sha256=$1', [batch.sha256]);
  if (prior.rows[0]) return { ...prior.rows[0], alreadyImported: true };
  const preview = await previewAudit(client, batch);
  if (preview.missing.length) throw new Error(`存在数据库中找不到的 POI：${preview.missing.slice(0, 20).join(', ')}`);
  if (preview.missingVenues.length) throw new Error(`存在数据库中找不到的所属场所：${preview.missingVenues.slice(0, 20).join(', ')}`);

  const poiIds = batch.records.map(record => record.poiId);
  const decisions = batch.records.map(record => record.decision);
  const names = batch.records.map(record => record.confirmedName);
  const suitable = batch.records.map(record => record.studentSuitable);
  const notes = batch.records.map(record => record.auditNote);
  const entityKinds = batch.records.map(record => record.entityKind);
  const venueIds = batch.records.map(record => record.venueId);
  const locationDetails = batch.records.map(record => record.locationDetail);
  const existenceStatuses = batch.records.map(record => record.existenceStatus);
  const verificationMethods = batch.records.map(record => record.verificationMethod);
  const verificationConfidences = batch.records.map(record => record.verificationConfidence);
  const verifiedAts = batch.records.map(record => record.verifiedAt);
  const reverifyAfters = batch.records.map(record => record.reverifyAfter);
  const evidenceUrls = batch.records.map(record => record.verificationEvidenceUrl);
  const verificationNotes = batch.records.map(record => record.verificationNote);
  await client.query(
    `INSERT INTO branch_audit_batches(id,content_sha256,source_filename,note)
     VALUES($1,$2,$3,$4)`,
    [batch.batchId, batch.sha256, batch.sourceFilename, '用户确认的商家集中审核结果'],
  );
  await client.query(
    `INSERT INTO branch_audit_batch_items(
       batch_id,branch_id,poi_id,previous_review_status,previous_name,
       previous_student_suitable,previous_student_audit_note,applied_review_status,applied_name,
       previous_entity_kind,previous_venue_id,previous_location_detail,previous_existence_status,
       previous_verification_method,previous_verification_confidence,previous_verified_at,
       previous_reverify_after,previous_verification_evidence_url,previous_verification_note,
       applied_existence_status
     )
     SELECT $1,b.id,i.poi_id,b.review_status,b.name,b.student_suitable,b.student_audit_note,i.decision,i.confirmed_name,
       b.entity_kind,b.venue_id,b.location_detail,b.existence_status,b.verification_method,
       b.verification_confidence,b.verified_at,b.reverify_after,b.verification_evidence_url,b.verification_note,
       i.existence_status
     FROM UNNEST($2::text[],$3::text[],$4::text[],$5::boolean[],$6::text[])
       AS i(poi_id,decision,confirmed_name,student_suitable,audit_note)
     JOIN branches b ON COALESCE(NULLIF(b.amap_poi,''),b.id)=i.poi_id`,
    [batch.batchId, poiIds, decisions, names, suitable, notes],
  );
  const updated = await client.query(
    `UPDATE branches b SET
       name=i.confirmed_name,review_status=i.decision,student_suitable=i.student_suitable,
       student_audit_note=i.audit_note,student_audited_at=NOW(),entity_kind=i.entity_kind,
       venue_id=i.venue_id,location_detail=i.location_detail,existence_status=i.existence_status,
       verification_method=i.verification_method,verification_confidence=i.verification_confidence,
       verified_at=i.verified_at,reverify_after=i.reverify_after,
       verification_evidence_url=i.evidence_url,verification_note=i.verification_note,updated_at=NOW()
     FROM UNNEST($1::text[],$2::text[],$3::text[],$4::boolean[],$5::text[],$6::text[],
       $7::text[],$8::text[],$9::text[],$10::text[],$11::smallint[],$12::timestamptz[],
       $13::timestamptz[],$14::text[],$15::text[])
       AS i(poi_id,decision,confirmed_name,student_suitable,audit_note,entity_kind,venue_id,
         location_detail,existence_status,verification_method,verification_confidence,verified_at,
         reverify_after,evidence_url,verification_note)
     WHERE COALESCE(NULLIF(b.amap_poi,''),b.id)=i.poi_id`,
    [poiIds, decisions, names, suitable, notes, entityKinds, venueIds, locationDetails,
      existenceStatuses, verificationMethods, verificationConfidences, verifiedAts,
      reverifyAfters, evidenceUrls, verificationNotes],
  );
  await client.query('UPDATE branch_audit_batches SET imported_count=$2 WHERE id=$1', [batch.batchId, updated.rowCount]);
  return { id: batch.batchId, status: 'imported', imported_count: updated.rowCount, alreadyImported: false };
}

module.exports = { prepareAuditPackage, previewAudit, importAudit };
