const { Pool } = require('pg');
const path = require('node:path');
const dotenv = require('dotenv');

// CLI 脚本不会经过 src/index.js，需在数据库模块中主动加载本地配置。
// 冒烟测试可显式跳过，避免误连真实数据库。
if (process.env.AI_EAT_SKIP_LOCAL_ENV !== 'true') {
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.amap.local'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.database.local'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });
}

let pool;

function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!databaseConfigured()) {
    const error = new Error('DATABASE_URL 尚未配置');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!pool) {
    const useSsl = process.env.DATABASE_SSL === 'true';
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number.parseInt(process.env.DATABASE_POOL_SIZE || '5', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: Number.parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS || '30000', 10),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
    // Supabase pooler may close an idle connection. pg emits that failure on
    // the Pool itself; without a listener Node treats it as an uncaught error
    // and terminates an otherwise recoverable import process.
    pool.on('error', error => {
      console.warn(`数据库空闲连接已断开，连接池将在下次查询时自动重连：${error.message}`);
    });
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { databaseConfigured, getPool, query, withTransaction, closePool };
