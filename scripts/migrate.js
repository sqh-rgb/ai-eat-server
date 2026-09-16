const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, closePool } = require('../src/db/pool');

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03']);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function runMigration(pool, file, sql) {
  const waits = [0, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]) await delay(waits[attempt]);
    try {
      await pool.query(sql);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_CODES.has(error.code) && !/connection timeout|ECONNRESET/i.test(error.message)) throw error;
      console.warn(`迁移 ${file} 连接中断，准备第 ${attempt + 2} 次尝试`);
    }
  }
  throw lastError;
}

async function main() {
  const directory = path.resolve(__dirname, '..', 'db', 'migrations');
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const pool = getPool();
  for (const file of files) {
    const sql = await fs.readFile(path.join(directory, file), 'utf8');
    await runMigration(pool, file, sql);
    console.log(`已执行迁移：${file}`);
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
