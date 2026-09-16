const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { prepareDishes, importDishes } = require('../src/import/dishCandidates');

function inputFile() {
  const index = process.argv.indexOf('--file');
  if (index < 0 || !process.argv[index + 1]) throw new Error('用法：node scripts/import-dishes.js --file dishes.json');
  return path.resolve(process.argv[index + 1]);
}

async function main() {
  const file = inputFile();
  const records = prepareDishes(JSON.parse(await fs.readFile(file, 'utf8')));
  const sourceIds = [...new Set(records.map(record => record.sourceId))];
  const runSource = sourceIds.length === 1 ? sourceIds[0] : 'manual';
  const runId = crypto.randomUUID();
  await getPool().query(
    "INSERT INTO ingestion_runs(id,source_id,status,note) VALUES($1,$2,'running',$3)",
    [runId, runSource, `本地候选文件：${path.basename(file)}；记录来源：${sourceIds.join(',')}`],
  );
  try {
    const result = await withTransaction(async client => {
      const stats = await importDishes(client, records);
      await client.query(
        "UPDATE ingestion_runs SET status='completed',ended_at=NOW(),discovered_count=$2,inserted_count=$3,updated_count=$4 WHERE id=$1",
        [runId, stats.total, stats.inserted, stats.updated],
      );
      return stats;
    });
    console.log(`菜品候选导入完成：${result.total} 条，新增 ${result.inserted}，更新 ${result.updated}`);
  } catch (error) {
    await getPool().query("UPDATE ingestion_runs SET status='failed',ended_at=NOW(),error_count=1,note=$2 WHERE id=$1", [runId, error.message]);
    throw error;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
