#!/usr/bin/env node
/**
 * Windows-Compatible Database Migration Script
 * Loads environment variables from .env before running migrations
 */

// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Load .env file from project root
dotenv.config({ path: resolve(rootDir, '.env') });

// Now import other modules
import fs from 'fs/promises';
import pg from 'pg';
const { Pool } = pg;

// Database configuration from environment variables
function getDBConfig() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'signals_strategy',
    user: process.env.DB_USER || 'signals_user',
    password: process.env.DB_PASSWORD || 'changeme',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  };

  return config;
}

async function runMigrations() {
  const config = getDBConfig();
  
  console.log('=== Database Migration Script (Windows Compatible) ===');
  console.log('Configuration:');
  console.log(`  Host: ${config.host}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  User: ${config.user}`);
  console.log(`  SSL: ${config.ssl ? 'enabled' : 'disabled'}`);
  console.log('');

  // Validate configuration
  if (!config.host || !config.database || !config.user || !config.password) {
    console.error('❌ Database configuration missing!');
    console.error('');
    console.error('Please ensure the following environment variables are set in .env:');
    console.error('  DB_HOST (e.g., localhost)');
    console.error('  DB_PORT (e.g., 5432)');
    console.error('  DB_NAME (e.g., signals_strategy)');
    console.error('  DB_USER (e.g., signals_user)');
    console.error('  DB_PASSWORD');
    console.error('');
    process.exit(1);
  }

  let pool;
  try {
    // Create connection pool
    console.log('Connecting to database...');
    pool = new Pool(config);

    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connection successful!');
    client.release();

    // Get migration files
    const migrationsDir = resolve(rootDir, 'db', 'migrations');
    console.log(`\nReading migrations from: ${migrationsDir}`);
    
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      await pool.end();
      return;
    }

    console.log(`Found ${files.length} migration file(s):\n`);

    // Run each migration
    for (const file of files) {
      const fullPath = resolve(migrationsDir, file);
      const sql = await fs.readFile(fullPath, 'utf8');
      const statements = sql.trim();
      
      if (!statements) {
        console.log(`  ⊘ Skipping empty migration: ${file}`);
        continue;
      }

      process.stdout.write(`  ▸ Running ${file}... `);
      try {
        await pool.query(statements);
        console.log('✓ done');
      } catch (error) {
        console.error('✗ FAILED');
        console.error(`\nMigration error in ${file}:`);
        console.error(`  Message: ${error.message}`);
        console.error(`  Code: ${error.code}`);
        if (error.detail) {
          console.error(`  Detail: ${error.detail}`);
        }
        await pool.end();
        process.exit(1);
      }
    }

    console.log('\n✅ All migrations applied successfully!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed!');
    console.error(`  Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Connection refused. Please check:');
      console.error('  1. PostgreSQL is installed and running');
      console.error('  2. PostgreSQL is listening on the correct host/port');
      console.error('  3. Firewall allows connections');
      console.error('\n  On Windows, check PostgreSQL service in Services (services.msc)');
      console.error('  Service name is usually "postgresql-x64-XX" where XX is the version');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 Host not found. Please check:');
      console.error(`  1. DB_HOST="${config.host}" is correct`);
      console.error('  2. You can reach the database server');
    } else if (error.code === '28P01') {
      console.error('\n💡 Authentication failed. Please check:');
      console.error('  1. DB_USER and DB_PASSWORD are correct');
      console.error('  2. User has access to the database');
    } else if (error.code === '3D000') {
      console.error('\n💡 Database does not exist. Please create it first:');
      console.error(`  createdb -U postgres ${config.database}`);
      console.error('  OR using psql:');
      console.error(`  psql -U postgres -c "CREATE DATABASE ${config.database};"`);
    }
    
    if (pool) {
      await pool.end();
    }
    process.exit(1);
  }
}

// Run migrations
runMigrations();
