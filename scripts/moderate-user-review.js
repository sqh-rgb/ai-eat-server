const { withTransaction, closePool } = require('../src/db/pool');
const { moderateReviewSubmission } = require('../src/services/reviewModeration');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const submissionId = argument('--id');
  const decision = argument('--decision');
  const reason = argument('--reason', '人工审核');
  if (!submissionId || !decision) {
    throw new Error('用法：npm run reviews:moderate -- --id <投稿ID> --decision approved|rejected --reason <原因>');
  }
  const result = await withTransaction(client => moderateReviewSubmission(client, {
    submissionId, decision, reason, actorLabel: 'local-reviewer',
  }));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePool);
