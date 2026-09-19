const crypto = require('node:crypto');
const { withTransaction, closePool } = require('../src/db/pool');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`缺少参数 ${name}`);
  return process.argv[index + 1];
}

async function main() {
  const type = argument('--type');
  const id = argument('--id');
  const decision = argument('--decision');
  const reasonIndex = process.argv.indexOf('--reason');
  const reason = reasonIndex >= 0 ? String(process.argv[reasonIndex + 1] || '') : '';
  if (!['branch', 'dish', 'license', 'discovery'].includes(type)) throw new Error('审核类型必须是 branch、dish、license 或 discovery');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('审核结果必须是 approved 或 rejected');
  const tables = { branch: 'branches', dish: 'dishes', license: 'food_licenses', discovery: 'discovery_leads' };
  await withTransaction(async client => {
    const changed = await client.query(`UPDATE ${tables[type]} SET review_status=$2,updated_at=NOW() WHERE id=$1`, [id, decision]);
    if (changed.rowCount !== 1) throw new Error('待审核对象不存在');
    await client.query(
      'INSERT INTO moderation_actions(id,entity_type,entity_id,action,reason) VALUES($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), type, id, decision, reason],
    );
  });
  console.log(`审核完成：${type} ${id} → ${decision}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
