/**
 * Database Metrics API Routes
 * 
 * Provides endpoints for monitoring database performance:
 * - Query performance statistics
 * - Connection pool metrics
 * - Slow query analysis
 * - Cache statistics
 * 
 * Part of 64 improvements roadmap - Improvement #5
 */

import { Router } from 'express';
import {
  getPoolStats,
  getQueryStats,
  getSlowQueries,
  getPerformanceSummary,
  clearQueryCache,
  resetQueryStats,
  setSlowQueryThreshold,
  healthCheck
} from '../../infrastructure/storage/enhanced-database.js';

const router = Router();

/**
 * GET /api/database/health
 * Database health check
 */
router.get('/health', async (req, res) => {
  try {
    const health = await healthCheck();
    res.status(health.healthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(500).json({
      healthy: false,
      error: error.message
    });
  }
});

/**
 * GET /api/database/pool
 * Get connection pool statistics
 */
router.get('/pool', (req, res) => {
  const stats = getPoolStats();
  
  if (!stats) {
    return res.status(503).json({
      error: 'Database pool not configured'
    });
  }
  
  res.json(stats);
});

/**
 * GET /api/database/queries
 * Get query performance statistics
 */
router.get('/queries', (req, res) => {
  const { name } = req.query;
  const stats = getQueryStats(name);
  
  res.json({
    queryStats: stats,
    totalQueries: stats ? Object.keys(stats).length : 0
  });
});

/**
 * GET /api/database/slow-queries
 * Get slow queries
 */
router.get('/slow-queries', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const slowQueries = getSlowQueries(limit);
  
  res.json({
    queries: slowQueries,
    count: slowQueries.length
  });
});

/**
 * GET /api/database/performance
 * Get comprehensive performance summary
 */
router.get('/performance', (req, res) => {
  const summary = getPerformanceSummary();
  res.json(summary);
});

/**
 * POST /api/database/cache/clear
 * Clear query result cache
 */
router.post('/cache/clear', (req, res) => {
  clearQueryCache();
  res.json({
    message: 'Query cache cleared successfully'
  });
});

/**
 * POST /api/database/stats/reset
 * Reset query performance statistics
 */
router.post('/stats/reset', (req, res) => {
  resetQueryStats();
  res.json({
    message: 'Query statistics reset successfully'
  });
});

/**
 * PUT /api/database/slow-query-threshold
 * Set slow query threshold
 */
router.put('/slow-query-threshold', (req, res) => {
  const { threshold } = req.body;
  
  if (!threshold || typeof threshold !== 'number' || threshold < 0) {
    return res.status(400).json({
      error: 'Invalid threshold value. Must be a positive number in milliseconds.'
    });
  }
  
  setSlowQueryThreshold(threshold);
  res.json({
    message: 'Slow query threshold updated successfully',
    threshold
  });
});

/**
 * GET /api/database/overview
 * Get comprehensive database metrics overview
 */
router.get('/overview', async (req, res) => {
  try {
    const [health, performance] = await Promise.all([
      healthCheck(),
      Promise.resolve(getPerformanceSummary())
    ]);
    
    res.json({
      health,
      performance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;
