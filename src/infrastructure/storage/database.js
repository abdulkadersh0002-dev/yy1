import { Pool } from 'pg';
import { appConfig } from '../../app/config.js';

let pool = null;

function getConfig() {
  const config = appConfig.database || {};

  const host = config.host;
  const database = config.name;
  const user = config.user;
  const password = config.password;

  if (!host || !database || !user || !password) {
    return null;
  }

  return {
    host,
    port: Number.isFinite(config.port) ? config.port : 5432,
    database,
    user,
    password,
    ssl: config.ssl === true ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 15000
  };
}

export function getPool() {
  if (pool) {
    return pool;
  }

  const config = getConfig();
  if (!config) {
    return null;
  }

  pool = new Pool(config);
  pool.on('error', (err) => {
    console.error('Database pool error:', err.message);
  });
  return pool;
}

export async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('Database is not configured');
  }
  return activePool.query(text, params);
}

export async function withClient(callback) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('Database is not configured');
  }

  const client = await activePool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
}
