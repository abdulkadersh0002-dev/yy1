import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
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

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    await closePool();
    return;
  }

  console.log(`Applying ${files.length} migration(s) to ${process.env.DB_NAME}...`);

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, 'utf8');
    const statements = sql.trim();
    if (!statements) {
      console.log(`- Skipping empty migration ${file}`);
      continue;
    }

    process.stdout.write(`- Running ${file}... `);
    try {
      await pool.query(statements);
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
