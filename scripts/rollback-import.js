const { randomUUID } = require('node:crypto');
const { getPool, withTransaction, closePool } = require('../src/db/pool');

function batchId() {
  const index = process.argv.indexOf('--batch');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：node scripts/rollback-import.js --batch <batch-id>');
  return process.argv[index + 1];
}

async function main() {
  getPool();
  const id = batchId();
  const result = await withTransaction(async client => {
    const batch = await client.query("SELECT status FROM review_import_batches WHERE id=$1 FOR UPDATE", [id]);
    if (!batch.rows[0]) throw new Error('导入批次不存在');
    if (batch.rows[0].status === 'rolled_back') return { count: 0, alreadyRolledBack: true };
    const removed = await client.query("UPDATE reviews SET status='removed',updated_at=NOW() WHERE import_batch_id=$1 AND status='published'", [id]);
    await client.query("UPDATE review_import_batches SET status='rolled_back',rolled_back_at=NOW() WHERE id=$1", [id]);
    await client.query(
      "INSERT INTO moderation_actions(id,entity_type,entity_id,action,reason) VALUES($1,'import_batch',$2,'rollback','命令行整批回滚')",
      [randomUUID(), id],
    );
    return { count: removed.rowCount, alreadyRolledBack: false };
  });
  console.log(result.alreadyRolledBack ? '该批次已经回滚' : `回滚完成：下架 ${result.count} 条评论`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
