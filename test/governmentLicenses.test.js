const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLicense, prepareLicenses } = require('../src/import/governmentLicenses');

test('许可导入只保留业务字段并规范日期', () => {
  const record = normalizeLicense({
    licenseNumber: 'JY123', name: '北碚区学生餐饮店', address: '天生路2号',
    scope: '热食类食品制售', issuedOn: '2026/1/2', validUntil: '2031/1/1', operatorName: '不应保存',
  });
  assert.equal(record.externalId, 'JY123');
  assert.equal(record.issuedOn, '2026-01-02');
  assert.equal(Object.hasOwn(record, 'operatorName'), false);
});

test('拒绝缺少名称或地址的许可记录', () => {
  assert.throws(() => prepareLicenses([{ name: '无地址店铺' }]), /缺少名称或经营地址/);
});
