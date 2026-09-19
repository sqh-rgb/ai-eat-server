const fs = require('node:fs/promises');
const path = require('node:path');
const { withTransaction, closePool } = require('../src/db/pool');
const { prepareLeads, importLeads } = require('../src/import/discoveryLeads');

function inputFile() {
  const index = process.argv.indexOf('--file');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：node scripts/import-discovery-leads.js --file leads.json');
  return path.resolve(process.argv[index + 1]);
}

async function main() {
  const records = prepareLeads(JSON.parse(await fs.readFile(inputFile(), 'utf8')));
  const result = await withTransaction(client => importLeads(client, records));
  console.log(`线索导入完成：${result.total} 条，新增 ${result.inserted}，更新 ${result.updated}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
