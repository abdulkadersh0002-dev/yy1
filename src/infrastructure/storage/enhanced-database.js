/**
 * Enhanced Database Module
 *
 * Enhances the base database module with:
 * - Query performance tracking
 * - Query result caching
 * - Connection pool monitoring
 * - Query metrics and statistics
 *
 * Part of 64 improvements roadmap - Improvement #5
 */

import {
  getPool,
  query as baseQuery,
  withClient as baseWithClient,
  closePool,
} from './database.js';
import { queryPerformanceTracker } from './query-performance-tracker.js';
import { CacheService } from '../services/cache-service.js';

// Cache instance for query results
const queryCache = new CacheService(1000, 60000); // 1000 items, 60s default TTL

/**
 * Enhanced query function with performance tracking and caching
 * @param {string} text - SQL query text
 * @param {any[]} params - Query parameters
 * @param {Object} options - Query options
 * @param {string} [options.name] - Query name for tracking
 * @param {boolean} [options.cache] - Whether to cache results
 * @param {number} [options.cacheTTL] - Cache TTL in ms
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params = [], options = {}) {
  const { name = 'unnamed', cache = false, cacheTTL = 60000 } = options;

  // Generate cache key if caching is enabled
  let cacheKey = null;
  if (cache) {
    cacheKey = _generateCacheKey(text, params);
    const cached = queryCache.get(cacheKey);
    if (cached) {
      // Track cache hit
      queryPerformanceTracker.trackQuery(
        `${name}_cached`,
        text,
        0, // No execution time for cache hit
        params
      );
      return cached;
    }
  }

  // Execute query with performance tracking
  const startTime = performance.now();
  let result;
  queryPerformanceTracker.trackQueryStart?.();

  try {
    result = await baseQuery(text, params);
    const duration = performance.now() - startTime;

    // Track query performance
    queryPerformanceTracker.trackQuery(name, text, duration, params);

    // Cache result if enabled
    if (cache && cacheKey) {
      queryCache.set(cacheKey, result, cacheTTL);
    }

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    queryPerformanceTracker.trackQuery(`${name}_error`, text, duration, params);
    throw error;
  }
}

/**
 * Enhanced withClient with performance tracking
 * @param {Function} callback - Callback function with client
 * @param {Object} options - Options
 * @param {string} [options.name] - Transaction name for tracking
 * @returns {Promise<any>} Result of callback
 */
export async function withClient(callback, options = {}) {
  const { name = 'transaction' } = options;
  const startTime = performance.now();
  queryPerformanceTracker.trackQueryStart?.();

  try {
    const result = await baseWithClient(callback);
    const duration = performance.now() - startTime;
    queryPerformanceTracker.trackQuery(name, 'TRANSACTION', duration, []);
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    queryPerformanceTracker.trackQuery(`${name}_error`, 'TRANSACTION', duration, []);
    throw error;
  }
}

/**
 * Get connection pool statistics
 * @returns {Object|null} Pool statistics
 */
export function getPoolStats() {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: pool.options.max,
    activeConnections: pool.totalCount - pool.idleCount,
    utilization: `${(((pool.totalCount - pool.idleCount) / pool.options.max) * 100).toFixed(2)}%`,
    config: {
      max: pool.options.max,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
      connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
    },
  };
}

/**
 * Get query performance statistics
 * @param {string} [queryName] - Optional specific query name
 * @returns {Object} Query statistics
 */
export function getQueryStats(queryName = null) {
  return queryPerformanceTracker.getStats(queryName);
}

/**
 * Get slow queries
 * @param {number} [limit=10] - Maximum number to return
 * @returns {Array} Slow queries
 */
export function getSlowQueries(limit = 10) {
  return queryPerformanceTracker.getSlowQueries(limit);
}

/**
 * Get comprehensive database performance summary
 * @returns {Object} Performance summary including pool and query stats
 */
export function getPerformanceSummary() {
  return {
    pool: getPoolStats(),
    queries: queryPerformanceTracker.getSummary(),
    cache: {
      size: queryCache.size(),
      hitRate: _calculateCacheHitRate(),
      config: {
        maxSize: queryCache.maxSize,
        defaultTTL: queryCache.defaultTTL,
      },
    },
  };
}

/**
 * Clear query result cache
 */
export function clearQueryCache() {
  queryCache.clear();
}

/**
 * Reset query performance statistics
 */
export function resetQueryStats() {
  queryPerformanceTracker.reset();
}

/**
 * Set slow query threshold
 * @param {number} thresholdMs - Threshold in milliseconds
 */
export function setSlowQueryThreshold(thresholdMs) {
  queryPerformanceTracker.setSlowQueryThreshold(thresholdMs);
}

/**
 * Health check for database connection
 * @returns {Promise<Object>} Health status
 */
export async function healthCheck() {
  const startTime = performance.now();

  try {
    await query('SELECT 1 as health', [], { name: 'health_check' });
    const duration = performance.now() - startTime;

    return {
      healthy: true,
      responseTime: Math.round(duration * 100) / 100,
      pool: getPoolStats(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      pool: getPoolStats(),
    };
  }
}

/**
 * Generate cache key from query and params
 * @private
 * @param {string} text - Query text
 * @param {any[]} params - Query parameters
 * @returns {string} Cache key
 */
function _generateCacheKey(text, params) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const paramsStr = JSON.stringify(params);
  return `query:${normalized}:${paramsStr}`;
}

/**
 * Calculate cache hit rate
 * @private
 * @returns {string} Hit rate percentage
 */
function _calculateCacheHitRate() {
  const allStats = queryPerformanceTracker.getStats();
  let totalQueries = 0;
  let cachedQueries = 0;

  for (const [name, stats] of Object.entries(allStats)) {
    if (name.endsWith('_cached')) {
      cachedQueries += stats.count;
    }
    totalQueries += stats.count;
  }

  if (totalQueries === 0) {
    return '0.00%';
  }
  return `${((cachedQueries / totalQueries) * 100).toFixed(2)}%`;
}

// Re-export closePool
export { closePool };
