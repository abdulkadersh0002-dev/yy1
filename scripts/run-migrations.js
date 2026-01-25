import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getPool, closePool } from '../src/storage/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../db/migrations');

async function runMigrations() {
  const pool = getPool();
  if (!pool) {
    console.error(
      'Database configuration missing. Ensure DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD are set.'
    );
    process.exit(1);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedRows = await pool.query(
    'SELECT filename, checksum FROM schema_migrations ORDER BY applied_at ASC'
  );
  const applied = new Map();
  for (const row of appliedRows.rows || []) {
    if (row?.filename) {
      applied.set(row.filename, row.checksum || null);
    }
  }

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    await closePool();
    return;
  }

  console.log(`Applying ${files.length} migration(s) to ${process.env.DB_NAME}...`);

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- Skipping ${file} (already applied)`);
      continue;
    }
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, 'utf8');
    const statements = sql.trim();
    if (!statements) {
      console.log(`- Skipping empty migration ${file}`);
      continue;
    }

    const checksum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
    const recordedChecksum = applied.get(file);
    if (recordedChecksum && recordedChecksum !== checksum) {
      console.error(
        `\nMigration checksum mismatch for ${file}. ` +
          'The migration file has changed after being applied.'
      );
      await closePool();
      process.exit(1);
    }

    process.stdout.write(`- Running ${file}... `);
    try {
      await pool.query(statements);
      await pool.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [file, checksum]
      );
      console.log('done');
    } catch (error) {
      console.error('\nMigration failed:', error.message);
      await closePool();
      process.exit(1);
    }
  }

  console.log('Migrations applied successfully.');
  await closePool();
}

runMigrations().catch(async (error) => {
  console.error('Unexpected migration error:', error.message);
  await closePool();
  process.exit(1);
});
