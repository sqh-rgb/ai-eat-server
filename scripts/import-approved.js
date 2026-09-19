const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { prepareBatch, importBatch } = require('../src/import/approvedReviews');

function inputFile() {
  const index = process.argv.indexOf('--file');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：node scripts/import-approved.js --file published_reviews.jsonl');
  return path.resolve(process.argv[index + 1]);
}

async function main() {
  getPool();
  const file = inputFile();
  const text = await fs.readFile(file, 'utf8');
  const batch = prepareBatch(text);
  const result = await withTransaction(client => importBatch(client, batch));
  console.log(result.alreadyImported
    ? `该文件已经导入：${result.id}，共 ${result.imported_count} 条`
    : `导入完成：${result.id}，新增 ${result.imported_count} 条`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
