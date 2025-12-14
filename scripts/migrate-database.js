#!/usr/bin/env node
/**
 * Database Migration Script
 * Runs all pending database migrations
 */

import { db, migrationRunner } from '../src/database/index.js';
import logger from '../src/services/logging/logger.js';

async function runMigrations() {
  try {
    logger.info('=== Database Migration Started ===');
    
    // Initialize database connection
    const connected = await db.initialize();
    
    if (!connected) {
      logger.error('Database not configured - skipping migrations');
      process.exit(1);
    }

    // Get migration status
    logger.info('Checking migration status...');
    const status = await migrationRunner.getStatus();
    
    logger.info('Migration Status:', {
      total: status.total,
      executed: status.executed,
      pending: status.pending
    });

    if (status.pending > 0) {
      logger.info(`Found ${status.pending} pending migrations:`);
      status.pendingList.forEach(m => logger.info(`  - ${m}`));
      
      // Run migrations
      logger.info('Running migrations...');
      const result = await migrationRunner.runMigrations();
      
      logger.info('=== Migration Complete ===', {
        executed: result.executed,
        total: result.total
      });
    } else {
      logger.info('No pending migrations');
    }

    // Close database connection
    await db.close();
    
    logger.info('=== Database Migration Finished Successfully ===');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', {
      error: error.message,
      stack: error.stack
    });
    
    try {
      await db.close();
    } catch (closeError) {
      // Ignore close errors
    }
    
    process.exit(1);
  }
}

// Run migrations
runMigrations();
