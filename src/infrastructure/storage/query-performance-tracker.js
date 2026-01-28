/**
 * Query Performance Tracker
 * 
 * Tracks database query performance metrics including:
 * - Execution times per query
 * - Slow query detection and logging
 * - Query statistics (min/max/avg/count)
 * - Most frequent and slowest queries
 * 
 * Part of 64 improvements roadmap - Improvement #5
 */

/**
 * @typedef {Object} QueryStats
 * @property {number} count - Number of times query was executed
 * @property {number} totalDuration - Total execution time in ms
 * @property {number} minDuration - Minimum execution time in ms
 * @property {number} maxDuration - Maximum execution time in ms
 * @property {number} avgDuration - Average execution time in ms
 * @property {number} lastExecuted - Timestamp of last execution
 */

/**
 * @typedef {Object} SlowQuery
 * @property {string} queryName - Name/identifier of the query
 * @property {string} queryText - The SQL query text (truncated)
 * @property {number} duration - Execution time in ms
 * @property {Date} timestamp - When the query was executed
 * @property {any[]} params - Query parameters (sanitized)
 */

class QueryPerformanceTracker {
  constructor() {
    /** @type {Map<string, QueryStats>} */
    this.queryStats = new Map();
    
    /** @type {SlowQuery[]} */
    this.slowQueries = [];
    
    /** @type {number} */
    this.slowQueryThreshold = 100; // ms
    
    /** @type {number} */
    this.maxSlowQueries = 50;
    
    /** @type {Date} */
    this.startTime = new Date();
  }

  /**
   * Track a query execution
   * @param {string} queryName - Name/identifier for the query
   * @param {string} queryText - The SQL query
   * @param {number} duration - Execution time in ms
   * @param {any[]} params - Query parameters
   */
  trackQuery(queryName, queryText, duration, params = []) {
    // Update statistics
    if (!this.queryStats.has(queryName)) {
      this.queryStats.set(queryName, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        lastExecuted: Date.now()
      });
    }

    const stats = this.queryStats.get(queryName);
    stats.count++;
    stats.totalDuration += duration;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.avgDuration = stats.totalDuration / stats.count;
    stats.lastExecuted = Date.now();

    // Track slow queries
    if (duration > this.slowQueryThreshold) {
      const slowQuery = {
        queryName,
        queryText: this._truncateQuery(queryText),
        duration: Math.round(duration * 100) / 100,
        timestamp: new Date(),
        params: this._sanitizeParams(params)
      };

      this.slowQueries.unshift(slowQuery);
      
      // Keep only recent slow queries
      if (this.slowQueries.length > this.maxSlowQueries) {
        this.slowQueries.pop();
      }

      // Log slow query
      console.warn(`[SLOW QUERY] ${queryName} took ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Get query statistics
   * @param {string} [queryName] - Optional specific query name
   * @returns {Object} Query statistics
   */
  getStats(queryName = null) {
    if (queryName) {
      const stats = this.queryStats.get(queryName);
      return stats ? { [queryName]: this._formatStats(stats) } : null;
    }

    const allStats = {};
    for (const [name, stats] of this.queryStats.entries()) {
      allStats[name] = this._formatStats(stats);
    }
    return allStats;
  }

  /**
   * Get slow queries
   * @param {number} [limit=10] - Maximum number of queries to return
   * @returns {SlowQuery[]} Array of slow queries
   */
  getSlowQueries(limit = 10) {
    return this.slowQueries.slice(0, limit);
  }

  /**
   * Get top slowest queries by average execution time
   * @param {number} [limit=10] - Number of queries to return
   * @returns {Array<{queryName: string, stats: Object}>}
   */
  getTopSlowestQueries(limit = 10) {
    const queries = Array.from(this.queryStats.entries())
      .map(([name, stats]) => ({
        queryName: name,
        stats: this._formatStats(stats)
      }))
      .sort((a, b) => b.stats.avgDuration - a.stats.avgDuration)
      .slice(0, limit);

    return queries;
  }

  /**
   * Get most frequent queries
   * @param {number} [limit=10] - Number of queries to return
   * @returns {Array<{queryName: string, stats: Object}>}
   */
  getMostFrequentQueries(limit = 10) {
    const queries = Array.from(this.queryStats.entries())
      .map(([name, stats]) => ({
        queryName: name,
        stats: this._formatStats(stats)
      }))
      .sort((a, b) => b.stats.count - a.stats.count)
      .slice(0, limit);

    return queries;
  }

  /**
   * Get comprehensive performance summary
   * @returns {Object} Performance summary
   */
  getSummary() {
    const now = Date.now();
    const uptimeMs = now - this.startTime.getTime();
    const totalQueries = Array.from(this.queryStats.values())
      .reduce((sum, stats) => sum + stats.count, 0);
    
    const totalDuration = Array.from(this.queryStats.values())
      .reduce((sum, stats) => sum + stats.totalDuration, 0);

    const avgDuration = totalQueries > 0 
      ? totalDuration / totalQueries 
      : 0;

    return {
      uptime: {
        ms: uptimeMs,
        seconds: Math.floor(uptimeMs / 1000),
        minutes: Math.floor(uptimeMs / 60000)
      },
      queries: {
        total: totalQueries,
        unique: this.queryStats.size,
        queriesPerSecond: totalQueries / (uptimeMs / 1000),
        avgDuration: Math.round(avgDuration * 100) / 100
      },
      slowQueries: {
        threshold: this.slowQueryThreshold,
        count: this.slowQueries.length,
        recent: this.slowQueries.slice(0, 5).map(q => ({
          name: q.queryName,
          duration: q.duration,
          timestamp: q.timestamp
        }))
      },
      topSlowest: this.getTopSlowestQueries(5),
      mostFrequent: this.getMostFrequentQueries(5)
    };
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.queryStats.clear();
    this.slowQueries = [];
    this.startTime = new Date();
  }

  /**
   * Set slow query threshold
   * @param {number} thresholdMs - Threshold in milliseconds
   */
  setSlowQueryThreshold(thresholdMs) {
    this.slowQueryThreshold = thresholdMs;
  }

  /**
   * Format stats for output
   * @private
   * @param {QueryStats} stats
   * @returns {Object}
   */
  _formatStats(stats) {
    return {
      count: stats.count,
      minDuration: Math.round(stats.minDuration * 100) / 100,
      maxDuration: Math.round(stats.maxDuration * 100) / 100,
      avgDuration: Math.round(stats.avgDuration * 100) / 100,
      totalDuration: Math.round(stats.totalDuration * 100) / 100,
      lastExecuted: new Date(stats.lastExecuted).toISOString()
    };
  }

  /**
   * Truncate query text for logging
   * @private
   * @param {string} queryText
   * @returns {string}
   */
  _truncateQuery(queryText) {
    const maxLength = 200;
    const cleaned = queryText.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength 
      ? cleaned.substring(0, maxLength) + '...'
      : cleaned;
  }

  /**
   * Sanitize query parameters for logging
   * @private
   * @param {any[]} params
   * @returns {any[]}
   */
  _sanitizeParams(params) {
    if (!Array.isArray(params)) return [];
    
    return params.map(param => {
      if (typeof param === 'string' && param.length > 50) {
        return param.substring(0, 50) + '...';
      }
      return param;
    });
  }
}

// Singleton instance
const queryPerformanceTracker = new QueryPerformanceTracker();

export { QueryPerformanceTracker, queryPerformanceTracker };
