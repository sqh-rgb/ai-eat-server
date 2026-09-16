const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { prepareLicenses, importLicenses } = require('../src/import/governmentLicenses');

function inputFile() {
  const index = process.argv.indexOf('--file');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：node scripts/import-government-licenses.js --file licenses.json');
  return path.resolve(process.argv[index + 1]);
}

async function main() {
  getPool();
  const file = inputFile();
  const records = prepareLicenses(JSON.parse(await fs.readFile(file, 'utf8')));
  const runId = crypto.randomUUID();
  await getPool().query(
    "INSERT INTO ingestion_runs(id,source_id,status,note) VALUES($1,'cq-beibei-food-license','running',$2)",
    [runId, `本地规范化文件：${path.basename(file)}`],
  );
  try {
    const result = await withTransaction(async client => {
      const stats = await importLicenses(client, records);
      await client.query(
        "UPDATE ingestion_runs SET status='completed',ended_at=NOW(),discovered_count=$2,inserted_count=$3,updated_count=$4 WHERE id=$1",
        [runId, stats.total, stats.inserted, stats.updated],
      );
      return stats;
    });
    console.log(`许可信息导入完成：${result.total} 条，新增 ${result.inserted}，更新 ${result.updated}`);
  } catch (error) {
    await getPool().query("UPDATE ingestion_runs SET status='failed',ended_at=NOW(),error_count=1,note=$2 WHERE id=$1", [runId, error.message]);
    throw error;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
