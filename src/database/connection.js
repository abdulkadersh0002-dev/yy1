/**
 * Database Connection Manager
 * Provides robust PostgreSQL/TimescaleDB connection with pooling,
 * retry logic, and health monitoring
 */

import pg from 'pg';
import logger from '../services/logging/logger.js';

const { Pool } = pg;

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 3000; // 3 seconds
    this.healthCheckInterval = null;
  }

  /**
   * Initialize database connection with configuration from environment
   */
  async initialize() {
    const config = this.getConfig();
    
    if (!config.enabled) {
      logger.info('Database persistence disabled (no DB credentials provided)');
      return false;
    }

    try {
      this.pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
        // Connection pool settings
        max: 20, // Maximum number of clients in pool
        min: 2, // Minimum number of clients in pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection fails
        maxUses: 7500, // Close connection after 7500 uses
        // Application name for monitoring
        application_name: 'intelligent-trading-system'
      });

      // Set up pool event handlers
      this.setupPoolEventHandlers();

      // Test connection
      await this.testConnection();

      // Start health check monitoring
      this.startHealthCheck();

      this.isConnected = true;
      logger.info('Database connection pool initialized successfully', {
        host: config.host,
        database: config.database,
        poolSize: this.pool.totalCount
      });

      return true;
    } catch (error) {
      logger.error('Failed to initialize database connection', { error: error.message });
      
      if (this.connectionAttempts < this.maxRetries) {
        this.connectionAttempts++;
        logger.info(`Retrying database connection (attempt ${this.connectionAttempts}/${this.maxRetries})...`);
        await this.sleep(this.retryDelay);
        return this.initialize();
      }

      throw error;
    }
  }

  /**
   * Get database configuration from environment
   */
  getConfig() {
    const host = process.env.DB_HOST;
    const port = parseInt(process.env.DB_PORT || '5432', 10);
    const database = process.env.DB_NAME;
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const ssl = process.env.DB_SSL === 'true';

    const enabled = !!(host && database && user && password);

    return {
      enabled,
      host,
      port,
      database,
      user,
      password,
      ssl
    };
  }

  /**
   * Set up event handlers for the connection pool
   */
  setupPoolEventHandlers() {
    this.pool.on('connect', () => {
      logger.debug('New client connected to database pool');
    });

    this.pool.on('acquire', () => {
      logger.debug('Client acquired from pool');
    });

    this.pool.on('remove', () => {
      logger.debug('Client removed from pool');
    });

    this.pool.on('error', (error) => {
      logger.error('Unexpected error on idle database client', { error: error.message });
    });
  }

  /**
   * Test database connection
   */
  async testConnection() {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
      logger.info('Database connection test successful', {
        time: result.rows[0].current_time,
        version: result.rows[0].pg_version.split(',')[0]
      });
    } finally {
      client.release();
    }
  }

  /**
   * Start periodic health check
   */
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.query('SELECT 1');
      } catch (error) {
        logger.error('Database health check failed', { error: error.message });
        this.isConnected = false;
      }
    }, 60000); // Check every minute
  }

  /**
   * Execute a query with automatic retry logic
   */
  async query(text, params = [], retries = 3) {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Executed database query', {
        duration,
        rows: result.rowCount,
        command: result.command
      });

      return result;
    } catch (error) {
      logger.error('Database query failed', { 
        error: error.message,
        query: text.substring(0, 100)
      });

      if (retries > 0 && this.isRetryableError(error)) {
        logger.info(`Retrying query (${retries} attempts remaining)...`);
        await this.sleep(1000);
        return this.query(text, params, retries - 1);
      }

      throw error;
    }
  }

  /**
   * Execute a transaction with automatic rollback on error
   */
  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableErrors = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      '57P01', // PostgreSQL: admin_shutdown
      '57P02', // PostgreSQL: crash_shutdown
      '57P03', // PostgreSQL: cannot_connect_now
      '58000', // PostgreSQL: system_error
      '58030'  // PostgreSQL: io_error
    ];

    return retryableErrors.some(code => 
      error.code === code || error.message.includes(code)
    );
  }

  /**
   * Get connection pool statistics
   */
  getStats() {
    if (!this.pool) {
      return null;
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      connected: this.isConnected
    };
  }

  /**
   * Gracefully close all connections
   */
  async close() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.pool) {
      try {
        await this.pool.end();
        logger.info('Database connection pool closed successfully');
        this.isConnected = false;
      } catch (error) {
        logger.error('Error closing database pool', { error: error.message });
        throw error;
      }
    }
  }

  /**
   * Utility function for sleep/delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const db = new DatabaseConnection();
export default db;
