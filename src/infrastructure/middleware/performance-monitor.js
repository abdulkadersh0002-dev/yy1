/**
 * Performance Monitoring Middleware
 *
 * Tracks response times, slow operations, and performance metrics
 * Part of Phase 1A Quick Wins - Performance & Monitoring improvements
 */

import logger from '../services/logging/logger.js';

// Performance thresholds (milliseconds)
const THRESHOLDS = {
  FAST: 100, // < 100ms = fast
  NORMAL: 500, // < 500ms = normal
  SLOW: 1000, // < 1000ms = slow
  VERY_SLOW: 3000, // >= 3000ms = very slow
};

// Performance statistics
const stats = {
  totalRequests: 0,
  fastRequests: 0,
  normalRequests: 0,
  slowRequests: 0,
  verySlowRequests: 0,
  totalDuration: 0,
  byEndpoint: new Map(),
  lastReset: Date.now(),
};
const MAX_ENDPOINT_STATS = 120;

/**
 * Track performance metrics for a request
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {number} duration - Duration in milliseconds
 * @param {number} statusCode - HTTP status code
 */
function trackMetrics(method, path, duration, statusCode) {
  stats.totalRequests++;
  stats.totalDuration += duration;

  // Categorize by speed
  if (duration < THRESHOLDS.FAST) {
    stats.fastRequests++;
  } else if (duration < THRESHOLDS.NORMAL) {
    stats.normalRequests++;
  } else if (duration < THRESHOLDS.SLOW) {
    stats.slowRequests++;
  } else {
    stats.verySlowRequests++;
  }

  // Track per-endpoint stats
  const endpoint = `${method} ${path}`;
  if (!stats.byEndpoint.has(endpoint)) {
    if (stats.byEndpoint.size >= MAX_ENDPOINT_STATS) {
      let oldestKey = null;
      let oldestSeen = Infinity;
      for (const [key, value] of stats.byEndpoint.entries()) {
        const seen = value?.lastSeen ?? 0;
        if (seen < oldestSeen) {
          oldestSeen = seen;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        stats.byEndpoint.delete(oldestKey);
      }
    }
    stats.byEndpoint.set(endpoint, {
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      avgDuration: 0,
      slowCount: 0,
      lastSeen: Date.now(),
    });
  }

  const endpointStats = stats.byEndpoint.get(endpoint);
  endpointStats.lastSeen = Date.now();
  endpointStats.count++;
  endpointStats.totalDuration += duration;
  endpointStats.minDuration = Math.min(endpointStats.minDuration, duration);
  endpointStats.maxDuration = Math.max(endpointStats.maxDuration, duration);
  endpointStats.avgDuration = endpointStats.totalDuration / endpointStats.count;

  if (duration >= THRESHOLDS.NORMAL) {
    endpointStats.slowCount++;
  }

  // Log slow requests
  if (duration >= THRESHOLDS.SLOW) {
    const level = duration >= THRESHOLDS.VERY_SLOW ? 'warn' : 'info';
    logger[level]('Slow request detected', {
      method,
      path,
      duration: `${duration}ms`,
      statusCode,
      threshold: duration >= THRESHOLDS.VERY_SLOW ? 'VERY_SLOW' : 'SLOW',
    });
  }
}

/**
 * Get current performance statistics
 * @returns {Object} Current stats
 */
export function getPerformanceStats() {
  const now = Date.now();
  const uptimeMs = now - stats.lastReset;
  const avgDuration = stats.totalRequests > 0 ? stats.totalDuration / stats.totalRequests : 0;

  return {
    uptime: {
      ms: uptimeMs,
      seconds: Math.floor(uptimeMs / 1000),
      minutes: Math.floor(uptimeMs / 60000),
    },
    requests: {
      total: stats.totalRequests,
      fast: stats.fastRequests,
      normal: stats.normalRequests,
      slow: stats.slowRequests,
      verySlow: stats.verySlowRequests,
      fastPercentage:
        stats.totalRequests > 0 ? ((stats.fastRequests / stats.totalRequests) * 100).toFixed(2) : 0,
      slowPercentage:
        stats.totalRequests > 0
          ? (((stats.slowRequests + stats.verySlowRequests) / stats.totalRequests) * 100).toFixed(2)
          : 0,
    },
    performance: {
      avgResponseTime: avgDuration.toFixed(2),
      totalDuration: stats.totalDuration,
      requestsPerSecond: uptimeMs > 0 ? ((stats.totalRequests / uptimeMs) * 1000).toFixed(2) : 0,
    },
    topSlowEndpoints: getTopSlowEndpoints(5),
    topBusiestEndpoints: getTopBusiestEndpoints(5),
  };
}

/**
 * Get top N slowest endpoints
 * @param {number} limit - Number of endpoints to return
 * @returns {Array} Slowest endpoints
 */
function getTopSlowEndpoints(limit = 5) {
  return Array.from(stats.byEndpoint.entries())
    .map(([endpoint, data]) => ({
      endpoint,
      avgDuration: data.avgDuration.toFixed(2),
      maxDuration: data.maxDuration,
      count: data.count,
      slowCount: data.slowCount,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, limit);
}

/**
 * Get top N busiest endpoints
 * @param {number} limit - Number of endpoints to return
 * @returns {Array} Busiest endpoints
 */
function getTopBusiestEndpoints(limit = 5) {
  return Array.from(stats.byEndpoint.entries())
    .map(([endpoint, data]) => ({
      endpoint,
      count: data.count,
      avgDuration: data.avgDuration.toFixed(2),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Reset performance statistics
 */
export function resetPerformanceStats() {
  stats.totalRequests = 0;
  stats.fastRequests = 0;
  stats.normalRequests = 0;
  stats.slowRequests = 0;
  stats.verySlowRequests = 0;
  stats.totalDuration = 0;
  stats.byEndpoint.clear();
  stats.lastReset = Date.now();

  logger.info('Performance statistics reset');
}

/**
 * Performance monitoring middleware
 * Tracks response time and logs slow requests
 */
export default function performanceMonitor(req, res, next) {
  const startTime = Date.now();

  // Add request start time
  req.startTime = startTime;

  // Capture original end method
  const originalEnd = res.end;

  // Override end method to capture timing
  res.end = function (...args) {
    // Calculate duration
    const duration = Date.now() - startTime;

    // Track metrics
    trackMetrics(req.method, req.path, duration, res.statusCode);

    // Add performance headers
    res.setHeader('X-Response-Time', `${duration}ms`);

    // Call original end
    originalEnd.apply(res, args);
  };

  next();
}

// Export thresholds for testing
export { THRESHOLDS };
