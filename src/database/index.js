/**
 * Database Module Index
 * Central export for all database functionality
 */

import db from './connection.js';
import { TradeRepository } from './repositories/TradeRepository.js';
import { SignalRepository } from './repositories/SignalRepository.js';

// Initialize repositories
export const tradeRepository = new TradeRepository();
export const signalRepository = new SignalRepository();

/**
 * Initialize database connection and run migrations if needed
 */
export async function initializeDatabase() {
  try {
    const initialized = await db.initialize();
    
    if (initialized) {
      // Optionally run migrations here
      // await runMigrations();
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Failed to initialize database:', error.message);
    // Don't throw - allow application to continue without persistence
    return false;
  }
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  await db.close();
}

/**
 * Get database health status
 */
export function getDatabaseHealth() {
  return {
    connected: db.isConnected,
    stats: db.getStats()
  };
}

// Export database connection
export { db };

export default {
  db,
  tradeRepository,
  signalRepository,
  initializeDatabase,
  closeDatabase,
  getDatabaseHealth
};
