const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { prepareAuditPackage, previewAudit, importAudit } = require('../src/import/branchAudit');

function options() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error('用法：npm run audit:import -- --file <json> [--apply]');
  return { file: path.resolve(args[fileIndex + 1]), apply: args.includes('--apply') };
}

async function main() {
  const input = options();
  const batch = prepareAuditPackage(await fs.readFile(input.file, 'utf8'));
  const pool = getPool();
  const preview = await previewAudit(pool, batch);
  console.log(JSON.stringify({ mode: input.apply ? 'apply' : 'preview', batchId: batch.batchId, ...preview }, null, 2));
  if (!input.apply) return;
  if (preview.missing.length || preview.missingVenues.length) throw new Error('预检失败，未写入数据库');
  const result = await withTransaction(client => importAudit(client, batch));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePool);
