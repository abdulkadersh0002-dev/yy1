/**
 * Metrics API Route
 *
 * Provides endpoints for monitoring and metrics
 * Part of Phase 1A Quick Wins
 */

import express from 'express';
import { getPerformanceStats, resetPerformanceStats } from '../middleware/performance-monitor.js';
import { getErrorStats } from '../middleware/error-handler.js';
import os from 'os';

const router = express.Router();

/**
 * GET /api/metrics/performance
 * Get performance statistics
 */
router.get('/performance', (req, res) => {
  const stats = getPerformanceStats();
  res.json({
    status: 'success',
    data: stats,
  });
});

/**
 * POST /api/metrics/performance/reset
 * Reset performance statistics
 */
router.post('/performance/reset', (req, res) => {
  resetPerformanceStats();
  res.json({
    status: 'success',
    message: 'Performance statistics reset',
  });
});

/**
 * GET /api/metrics/errors
 * Get error statistics
 */
router.get('/errors', (req, res) => {
  const stats = getErrorStats();
  res.json({
    status: 'success',
    data: stats,
  });
});

/**
 * GET /api/metrics/system
 * Get system metrics
 */
router.get('/system', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  res.json({
    status: 'success',
    data: {
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`,
        heapUsedPercentage: `${((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2)}%`,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      system: {
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        memoryUsage: `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(2)}%`,
        cpus: os.cpus().length,
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
      },
    },
  });
});

/**
 * GET /api/metrics/overview
 * Get comprehensive metrics overview
 */
router.get('/overview', (req, res) => {
  const perfStats = getPerformanceStats();
  const errorStats = getErrorStats();
  const memUsage = process.memoryUsage();

  res.json({
    status: 'success',
    data: {
      performance: {
        avgResponseTime: perfStats.performance.avgResponseTime,
        requestsPerSecond: perfStats.performance.requestsPerSecond,
        totalRequests: perfStats.requests.total,
        slowPercentage: `${perfStats.requests.slowPercentage}%`,
      },
      errors: {
        total: errorStats.total,
        topCategories: Object.entries(errorStats.byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([category, count]) => ({ category, count })),
      },
      system: {
        memoryUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        uptime: `${Math.floor(process.uptime() / 60)} minutes`,
      },
    },
  });
});

export default router;
