const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');
const { prepareBatch, importBatch } = require('../src/import/approvedReviews');
const { importLicenses, prepareLicenses } = require('../src/import/governmentLicenses');
const { importLeads, prepareLeads } = require('../src/import/discoveryLeads');
const { importBranches, prepareBranches } = require('../src/import/branchCandidates');
const { importDishes, prepareDishes } = require('../src/import/dishCandidates');
const { prepareAuditPackage, importAudit } = require('../src/import/branchAudit');

async function memoryClient() {
  const memory = newDb();
  memory.public.registerFunction({
    name: 'char_length', args: [DataType.text], returns: DataType.integer,
    implementation: value => String(value).length,
  });
  memory.public.registerFunction({
    name: 'btrim', args: [DataType.text], returns: DataType.text,
    implementation: value => String(value).trim(),
  });
  memory.public.registerFunction({
    name: 'nullif', args: [DataType.text, DataType.text], returns: DataType.text,
    implementation: (value, other) => (value === other ? null : value),
  });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const migrationDirectory = path.join(__dirname, '..', 'db', 'migrations');
  // pg-mem 不实现 PL/pgSQL trigger；该迁移另有静态测试，线上 PostgreSQL 仍会正常执行。
  const files = fs.readdirSync(migrationDirectory)
    .filter(name => name.endsWith('.sql') && !name.endsWith('.postgres.sql')).sort();
  for (const file of files) {
    await pool.query(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'));
  }
  return { pool, client: await pool.connect() };
}

test('核心迁移、来源导入和 approved-only 评论可在同一数据库运行', async () => {
  const { pool, client } = await memoryClient();
  try {
    await client.query("INSERT INTO merchants(id,canonical_name,review_status) VALUES('merchant:B001','学生小店','approved')");
    await client.query("INSERT INTO branches(id,merchant_id,amap_poi,name,review_status,student_suitable,existence_status) VALUES('B001','merchant:B001','B001','学生小店','approved',TRUE,'confirmed')");

    const batch = prepareBatch(`${JSON.stringify({
      _id: 'public-1', amapPoiId: 'B001', publicText: '价格合适，味道不错。',
      sourceCommentHash: 'source-hash-1', publicMedia: [], status: 'published',
    })}\n`);
    const imported = await importBatch(client, batch);
    assert.equal(imported.imported_count, 1);
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM reviews WHERE status='published'")).rows[0].count, 1);

    const licenses = prepareLicenses([{ name: '北碚区学生小店', address: '天生路2号', status: '新办' }]);
    assert.equal((await importLicenses(client, licenses)).inserted, 1);
    const leads = prepareLeads([{ platform: 'douyin', name: '学生小店', dishes: ['鸡腿饭'], url: 'https://www.douyin.com/example' }]);
    assert.equal((await importLeads(client, leads)).inserted, 1);
  } finally {
    client.release();
    await pool.end();
  }
});

test('商家和菜品先以 candidate 导入，重复导入保持幂等且不覆盖审核结论', async () => {
  const { pool, client } = await memoryClient();
  try {
    const branches = prepareBranches([{ branchId: 'small-shop-1', sourceId: 'manual', name: '学生小馆', address: '西大周边' }]);
    assert.deepEqual(await importBranches(client, branches), { total: 1, inserted: 1, updated: 0 });
    await client.query("UPDATE branches SET review_status='approved' WHERE id='small-shop-1'");
    assert.deepEqual(await importBranches(client, branches), { total: 1, inserted: 0, updated: 0 });
    assert.equal((await client.query("SELECT review_status FROM branches WHERE id='small-shop-1'")).rows[0].review_status, 'approved');

    const dishes = prepareDishes([{ branchId: 'small-shop-1', sourceId: 'manual', name: '鸡腿饭', price: 15, spiceLevel: 1 }]);
    assert.deepEqual(await importDishes(client, dishes), { total: 1, inserted: 1, updated: 0 });
    assert.equal((await client.query('SELECT review_status FROM dishes')).rows[0].review_status, 'candidate');
    assert.deepEqual(await importDishes(client, []), { total: 0, inserted: 0, updated: 0 });
  } finally {
    client.release();
    await pool.end();
  }
});

test('候选同步不会覆盖已批准目录数据，但会刷新来源记录', async () => {
  const { pool, client } = await memoryClient();
  try {
    const branchId = 'approved-branch-1';
    const merchantId = 'merchant:approved-branch-1';
    const dishId = 'approved-dish-1';
    const initialBranch = prepareBranches([{
      branchId, brandId: merchantId, sourceId: 'manual', externalId: 'manual-branch-1',
      name: '审核名称', address: '审核地址', avgCost: 18,
    }]);
    const initialDish = prepareDishes([{
      id: dishId, branchId, sourceId: 'manual', name: '审核菜品', price: 18,
    }]);
    await importBranches(client, initialBranch);
    await importDishes(client, initialDish);
    await client.query("UPDATE merchants SET review_status='approved' WHERE id=$1", [merchantId]);
    await client.query("UPDATE branches SET review_status='approved' WHERE id=$1", [branchId]);
    await client.query("UPDATE dishes SET review_status='approved' WHERE id=$1", [dishId]);
    const beforeBranchSource = (await client.query(
      "SELECT normalized_hash FROM source_records WHERE id='manual:branch:manual-branch-1'",
    )).rows[0].normalized_hash;
    const dishSource = await client.query(
      "SELECT normalized_hash FROM source_records WHERE source_id='manual' AND entity_type='dish'",
    );
    assert.equal(dishSource.rows.length, 1);
    const beforeDishSource = dishSource.rows[0].normalized_hash;

    await importBranches(client, prepareBranches([{
      branchId, brandId: merchantId, sourceId: 'manual', externalId: 'manual-branch-1',
      name: '候选新名称', address: '候选新地址', avgCost: 38,
    }]));
    await importDishes(client, prepareDishes([{
      id: dishId, branchId, sourceId: 'manual', name: '候选新菜品', price: 38,
    }]));

    assert.deepEqual((await client.query(
      'SELECT canonical_name, review_status FROM merchants WHERE id=$1', [merchantId],
    )).rows[0], { canonical_name: '审核名称', review_status: 'approved' });
    assert.deepEqual((await client.query(
      'SELECT name,address,avg_cost,review_status FROM branches WHERE id=$1', [branchId],
    )).rows[0], { name: '审核名称', address: '审核地址', avg_cost: 18, review_status: 'approved' });
    assert.deepEqual((await client.query(
      'SELECT name,price,review_status FROM dishes WHERE id=$1', [dishId],
    )).rows[0], { name: '审核菜品', price: 18, review_status: 'approved' });
    const afterBranchSource = (await client.query(
      "SELECT normalized_hash FROM source_records WHERE id='manual:branch:manual-branch-1'",
    )).rows[0].normalized_hash;
    const afterDishSource = await client.query(
      "SELECT normalized_hash FROM source_records WHERE source_id='manual' AND entity_type='dish' AND external_id=$1",
      [dishId],
    );
    assert.equal(afterDishSource.rows.length, 1);
    assert.notEqual(afterBranchSource, beforeBranchSource);
    assert.notEqual(afterDishSource.rows[0].normalized_hash, beforeDishSource);
  } finally {
    client.release();
    await pool.end();
  }
});

test('升级后兼容旧版菜品来源键并更新同一来源记录', async () => {
  const { pool, client } = await memoryClient();
  try {
    const branchId = 'legacy-dish-branch-1';
    const dishId = 'legacy-dish-1';
    const legacyName = '旧版菜品';
    const name = '升级后菜品';
    const legacyExternalId = `${branchId}:${legacyName}`;
    const legacySourceRecordId = `manual:dish:${crypto.createHash('sha256').update(legacyExternalId).digest('hex')}`;
    await importBranches(client, prepareBranches([{
      branchId, sourceId: 'manual', name: '兼容测试分店', address: '测试地址',
    }]));
    await client.query(
      `INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload,review_status)
       VALUES($1,'manual',$2,'dish','https://example.com/legacy','legacy-hash',$3::jsonb,'approved')`,
      [legacySourceRecordId, legacyExternalId, JSON.stringify({ branchId, name: legacyName, price: 12 })],
    );
    await client.query(
      "INSERT INTO dishes(id,branch_id,name,review_status) VALUES($1,$2,$3,'candidate')",
      [dishId, branchId, legacyName],
    );

    assert.deepEqual(await importDishes(client, prepareDishes([{
      id: dishId, branchId, sourceId: 'manual', name, price: 18,
    }])), { total: 1, inserted: 0, updated: 1 });
    const sourceRecords = await client.query(
      "SELECT id,external_id,normalized_hash,review_status FROM source_records WHERE source_id='manual' AND entity_type='dish'",
    );
    assert.equal(sourceRecords.rows.length, 1);
    assert.equal(sourceRecords.rows[0].id, legacySourceRecordId);
    assert.equal(sourceRecords.rows[0].external_id, dishId);
    assert.notEqual(sourceRecords.rows[0].normalized_hash, 'legacy-hash');
    assert.equal(sourceRecords.rows[0].review_status, 'approved');
  } finally {
    client.release();
    await pool.end();
  }
});

test('集中审核会保存候选分店的旧值并写入完整核实结论', async () => {
  const { pool, client } = await memoryClient();
  try {
    const branchId = 'audited-candidate-1';
    await importBranches(client, prepareBranches([{
      branchId, sourceId: 'manual', name: '审核前名称', address: '西大周边',
    }]));
    const batch = prepareAuditPackage(JSON.stringify({
      sourceWorkbook: '集中审核.json',
      records: [{
        poiId: branchId, decision: 'approved', confirmedName: '审核后名称', studentSuitable: true,
        auditNote: '适合学生就餐', entityKind: 'standalone_store', locationDetail: '校门口东侧',
        existenceStatus: 'confirmed', verificationMethod: 'onsite', verificationConfidence: 95,
        verifiedAt: '2026-09-16T08:00:00.000Z', reverifyAfter: '2027-03-16T08:00:00.000Z',
        verificationEvidenceUrl: 'https://example.com/evidence', verificationNote: '现场核实营业中',
      }],
    }));

    assert.deepEqual(await importAudit(client, batch), {
      id: batch.batchId, status: 'imported', imported_count: 1, alreadyImported: false,
    });
    assert.deepEqual((await client.query(
      'SELECT name,review_status,student_suitable,existence_status,verification_method,verification_confidence,verification_note FROM branches WHERE id=$1',
      [branchId],
    )).rows[0], {
      name: '审核后名称', review_status: 'approved', student_suitable: true,
      existence_status: 'confirmed', verification_method: 'onsite', verification_confidence: 95,
      verification_note: '现场核实营业中',
    });
    assert.deepEqual((await client.query(
      `SELECT previous_review_status,previous_name,previous_entity_kind,previous_existence_status,
              previous_verification_method,previous_verification_confidence
       FROM branch_audit_batch_items WHERE batch_id=$1 AND branch_id=$2`,
      [batch.batchId, branchId],
    )).rows[0], {
      previous_review_status: 'candidate', previous_name: '审核前名称', previous_entity_kind: 'unknown',
      previous_existence_status: 'unverified', previous_verification_method: 'none',
      previous_verification_confidence: 0,
    });
  } finally {
    client.release();
    await pool.end();
  }
});

test('评论菜品必须属于已审核分店，回复顺序颠倒仍能关联', async () => {
  const { pool, client } = await memoryClient();
  try {
    await client.query("INSERT INTO merchants(id,canonical_name,review_status) VALUES('m1','一号店','approved'),('m2','二号店','approved')");
    await client.query("INSERT INTO branches(id,merchant_id,name,review_status,student_suitable,existence_status) VALUES('b1','m1','一号店','approved',TRUE,'confirmed'),('b2','m2','二号店','approved',TRUE,'confirmed')");
    await client.query("INSERT INTO dishes(id,branch_id,name,review_status) VALUES('dish-1','b1','鸡腿饭','approved')");
    const invalid = prepareBatch(`${JSON.stringify({ _id: 'bad', restaurantId: 'b2', dishId: 'dish-1', publicText: '分店绑定错误', sourceCommentHash: 'bad-source' })}\n`);
    await assert.rejects(importBatch(client, invalid), /不属于对应分店/);

    const reply = { _id: 'reply', restaurantId: 'b1', publicText: '我也觉得不错', sourceCommentHash: 'reply-source', parentSourceCommentHash: 'root-source' };
    const root = { _id: 'root', restaurantId: 'b1', publicText: '鸡腿饭很实惠', sourceCommentHash: 'root-source' };
    const valid = prepareBatch(`${JSON.stringify(reply)}\n${JSON.stringify(root)}\n`);
    assert.equal((await importBatch(client, valid)).imported_count, 2);
    assert.equal((await client.query("SELECT parent_review_id FROM reviews WHERE id='reply'")).rows[0].parent_review_id, 'root');
  } finally {
    client.release();
    await pool.end();
  }
});
