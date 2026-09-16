const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareAuditPackage } = require('../src/import/branchAudit');

test('商家审核包接受明确的批准记录并生成稳定批次', () => {
  const text = JSON.stringify({ sourceWorkbook: 'audit.xlsx', records: [{
    poiId: 'B001', decision: 'approved', confirmedName: '学生小店',
    studentSuitable: true, auditNote: '用户确认', entityKind: 'standalone_store',
    existenceStatus: 'confirmed', verificationMethod: 'multi_source',
    verificationConfidence: 85, verifiedAt: '2026-09-13T00:00:00Z',
    verificationEvidenceUrl: 'https://example.com/evidence',
  }] });
  const first = prepareAuditPackage(text);
  const second = prepareAuditPackage(text);
  assert.equal(first.records.length, 1);
  assert.equal(first.batchId, second.batchId);
});

test('商家审核包拒绝重复 POI', () => {
  assert.throws(() => prepareAuditPackage(JSON.stringify({ records: [
    { poiId: 'B001', decision: 'rejected', confirmedName: '甲', studentSuitable: true,
      entityKind: 'unknown', existenceStatus: 'uncertain', verificationMethod: 'none', verificationConfidence: 0 },
    { poiId: 'B001', decision: 'rejected', confirmedName: '乙', studentSuitable: true,
      entityKind: 'unknown', existenceStatus: 'uncertain', verificationMethod: 'none', verificationConfidence: 0 },
  ] })), /重复 POI/);
});

test('商家审核包拒绝含糊决定', () => {
  assert.throws(() => prepareAuditPackage(JSON.stringify({ records: [{
    poiId: 'B004', decision: 'maybe', confirmedName: '乙', studentSuitable: true,
    entityKind: 'unknown', existenceStatus: 'uncertain', verificationMethod: 'none', verificationConfidence: 0,
  }] })), /审核决定无效/);
});

test('不允许把未确认存在的商家批准上线', () => {
  assert.throws(() => prepareAuditPackage(JSON.stringify({ records: [{
    poiId: 'B002', decision: 'approved', confirmedName: '存疑店铺', studentSuitable: true,
    entityKind: 'standalone_store', existenceStatus: 'uncertain', verificationMethod: 'map',
    verificationConfidence: 50, verifiedAt: '2026-09-13T00:00:00Z', verificationNote: '仅地图线索',
  }] })), /必须有已确认营业状态/);
});

test('档口必须绑定所属美食街或食堂', () => {
  assert.throws(() => prepareAuditPackage(JSON.stringify({ records: [{
    poiId: 'B003', decision: 'approved', confirmedName: '华姐烧烤', studentSuitable: true,
    entityKind: 'stall', existenceStatus: 'confirmed', verificationMethod: 'onsite',
    verificationConfidence: 90, verifiedAt: '2026-09-13T00:00:00Z', verificationNote: '现场核实',
  }] })), /必须填写所属美食街或食堂/);
});
