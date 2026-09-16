const { randomUUID } = require('node:crypto');
const { withTransaction, closePool } = require('../src/db/pool');

function batchId() {
  const index = process.argv.indexOf('--batch');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：npm run audit:rollback -- --batch <batch-id>');
  return process.argv[index + 1];
}

async function main() {
  const id = batchId();
  const result = await withTransaction(async client => {
    const batch = await client.query('SELECT status FROM branch_audit_batches WHERE id=$1 FOR UPDATE', [id]);
    if (!batch.rows[0]) throw new Error('审核批次不存在');
    if (batch.rows[0].status === 'rolled_back') return { restored: 0, alreadyRolledBack: true };
    const restored = await client.query(
      `UPDATE branches b SET review_status=i.previous_review_status,name=i.previous_name,
         student_suitable=i.previous_student_suitable,student_audit_note=i.previous_student_audit_note,
         student_audited_at=NULL,entity_kind=i.previous_entity_kind,venue_id=i.previous_venue_id,
         location_detail=i.previous_location_detail,existence_status=i.previous_existence_status,
         verification_method=i.previous_verification_method,
         verification_confidence=i.previous_verification_confidence,verified_at=i.previous_verified_at,
         reverify_after=i.previous_reverify_after,
         verification_evidence_url=i.previous_verification_evidence_url,
         verification_note=i.previous_verification_note,updated_at=NOW()
       FROM branch_audit_batch_items i WHERE i.batch_id=$1 AND b.id=i.branch_id`,
      [id],
    );
    await client.query("UPDATE branch_audit_batches SET status='rolled_back',rolled_back_at=NOW() WHERE id=$1", [id]);
    await client.query(
      "INSERT INTO moderation_actions(id,entity_type,entity_id,action,reason) VALUES($1,'branch_audit_batch',$2,'rollback','命令行整批回滚')",
      [randomUUID(), id],
    );
    return { restored: restored.rowCount, alreadyRolledBack: false };
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePool);
