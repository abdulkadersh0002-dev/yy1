import { Pool } from 'pg';

let pool = null;

function getConfig() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL } = process.env;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    return null;
  }

  return {
    host: DB_HOST,
    port: DB_PORT ? Number(DB_PORT) : 5432,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
