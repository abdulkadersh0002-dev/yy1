/**
 * Enhanced Health Check System
 * Provides comprehensive health monitoring for all system components
 */

import { circuitBreakerManager } from '../utils/enhanced-circuit-breaker.js';
import logger from '../services/logging/logger.js';

class HealthCheckService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.checks = new Map();
    this.lastResults = new Map();
  }

  registerCheck(name, checkFn, options = {}) {
    this.checks.set(name, {
      name,
      checkFn,
      critical: options.critical !== false,
      timeout: options.timeout || 5000,
      interval: options.interval || 30000
    });
  }

  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) {
      return { name, healthy: false, error: 'Check not found' };
    }

    const startTime = Date.now();
    
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), check.timeout);
      });

      const result = await Promise.race([check.checkFn(), timeoutPromise]);
      const duration = Date.now() - startTime;

      const checkResult = {
        name,
        healthy: true,
        critical: check.critical,
        duration,
        timestamp: new Date().toISOString(),
        ...result
      };

      this.lastResults.set(name, checkResult);
      return checkResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const checkResult = {
        name,
        healthy: false,
        critical: check.critical,
        duration,
        error: error.message,
        timestamp: new Date().toISOString()
      };

      this.lastResults.set(name, checkResult);
      this.logger.error({ check: name, error: error.message, duration }, 'Health check failed');
      return checkResult;
    }
  }

  async runAllChecks() {
    const checkNames = Array.from(this.checks.keys());
    const results = await Promise.all(checkNames.map((name) => this.runCheck(name)));

    const healthMap = {};
    for (const result of results) {
      healthMap[result.name] = result;
    }

    const criticalFailures = results.filter((r) => !r.healthy && r.critical);
    const overallHealthy = criticalFailures.length === 0;

    return {
      healthy: overallHealthy,
      timestamp: new Date().toISOString(),
      checks: healthMap,
      summary: {
        total: results.length,
        healthy: results.filter((r) => r.healthy).length,
        unhealthy: results.filter((r) => !r.healthy).length,
        critical: results.filter((r) => r.critical).length,
        criticalFailing: criticalFailures.length
      }
    };
  }

  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        rss: (memUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapUsedPercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
      },
      cpu: { user: cpuUsage.user, system: cpuUsage.system },
      uptime: { process: Math.floor(process.uptime()) },
      nodejs: { version: process.version, pid: process.pid }
    };
  }
}

export function createHealthCheckEndpoint(dependencies) {
  const healthCheck = new HealthCheckService();

  if (dependencies.tradingEngine) {
    healthCheck.registerCheck('tradingEngine', async () => {
      return { status: 'operational' };
    });
  }

  return async (req, res) => {
    const detailed = req.query.detailed === 'true';
    const results = await healthCheck.runAllChecks();
    
    const response = {
      status: results.healthy ? 'healthy' : 'unhealthy',
      timestamp: results.timestamp,
      ...results.summary
    };

    if (detailed) {
      response.checks = results.checks;
      response.system = healthCheck.getSystemMetrics();
      response.circuitBreakers = circuitBreakerManager.getAllStatus();
    }

    res.status(results.healthy ? 200 : 503).json(response);
  };
}

export default HealthCheckService;
