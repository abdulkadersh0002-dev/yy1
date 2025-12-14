/**
 * Database Migration Runner
 * Executes all pending SQL migrations in order
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './connection.js';
import logger from '../services/logging/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MigrationRunner {
  constructor() {
    this.migrationsPath = join(__dirname, '../../db/migrations');
  }

  /**
   * Initialize migrations table
   */
  async initializeMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    await db.query(query);
    logger.info('Migrations table initialized');
  }

  /**
   * Get list of executed migrations
   */
  async getExecutedMigrations() {
    try {
      const result = await db.query('SELECT migration_name FROM schema_migrations ORDER BY migration_name');
      return result.rows.map(row => row.migration_name);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get list of migration files
   */
  async getMigrationFiles() {
    try {
      const files = await readdir(this.migrationsPath);
      return files
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch (error) {
      logger.error('Failed to read migrations directory', { error: error.message });
      return [];
    }
  }
  
  // Export as function for compatibility
  static async getMigrationFiles() {
    const runner = new MigrationRunner();
    return runner.getMigrationFiles();
  }

  /**
   * Execute a single migration
   */
  async executeMigration(filename) {
    const filePath = join(this.migrationsPath, filename);
    
    try {
      const sql = await readFile(filePath, 'utf-8');
      
      await db.transaction(async (client) => {
        // Execute migration SQL
        await client.query(sql);
        
        // Record migration
        await client.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [filename]
        );
      });
      
      logger.info(`Migration executed: ${filename}`);
      return true;
    } catch (error) {
      logger.error(`Migration failed: ${filename}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations() {
    try {
      // Initialize migrations table
      await this.initializeMigrationsTable();
      
      // Get executed and pending migrations
      const executedMigrations = await this.getExecutedMigrations();
      const allMigrations = await getMigrationFiles();
      const pendingMigrations = allMigrations.filter(
        m => !executedMigrations.includes(m)
      );

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations');
        return {
          executed: 0,
          pending: 0,
          total: allMigrations.length
        };
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      // Execute each pending migration
      let executedCount = 0;
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
        executedCount++;
      }

      logger.info(`Executed ${executedCount} migrations successfully`);
      
      return {
        executed: executedCount,
        pending: 0,
        total: allMigrations.length
      };
    } catch (error) {
      logger.error('Migration runner failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Check migration status
   */
  async getStatus() {
    try {
      await this.initializeMigrationsTable();
      
      const executedMigrations = await this.getExecutedMigrations();
      const allMigrations = await this.getMigrationFiles();
      const pendingMigrations = allMigrations.filter(
        m => !executedMigrations.includes(m)
      );

      return {
        total: allMigrations.length,
        executed: executedMigrations.length,
        pending: pendingMigrations.length,
        executedList: executedMigrations,
        pendingList: pendingMigrations
      };
    } catch (error) {
      logger.error('Failed to get migration status', { error: error.message });
      throw error;
    }
  }
}

export default new MigrationRunner();
