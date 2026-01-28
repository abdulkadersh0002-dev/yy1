/**
 * Tests for Performance Monitor Middleware
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import performanceMonitor, {
  getPerformanceStats,
  resetPerformanceStats,
  THRESHOLDS,
} from '../../../src/infrastructure/middleware/performance-monitor.js';

describe('Performance Monitor Middleware', () => {
  beforeEach(() => {
    resetPerformanceStats();
  });

  it('should track request metrics', () => {
    const req = {
      method: 'GET',
      path: '/test',
    };
    const res = {
      end: function () {},
      setHeader: function () {},
      statusCode: 200,
    };
    const next = () => {};

    // Execute middleware
    performanceMonitor(req, res, next);

    // Simulate response end
    res.end();

    const stats = getPerformanceStats();
    assert.strictEqual(stats.requests.total, 1);
  });

  it('should reset statistics', () => {
    const req = { method: 'GET', path: '/test' };
    const res = {
      end: function () {},
      setHeader: function () {},
      statusCode: 200,
    };

    performanceMonitor(req, res, () => {});
    res.end();

    let stats = getPerformanceStats();
    assert.strictEqual(stats.requests.total, 1);

    resetPerformanceStats();
    stats = getPerformanceStats();
    assert.strictEqual(stats.requests.total, 0);
  });

  it('should add response time header', () => {
    const req = { method: 'GET', path: '/test' };
    let headerSet = false;
    let headerValue = '';

    const res = {
      end: function () {},
      setHeader: function (name, value) {
        if (name === 'X-Response-Time') {
          headerSet = true;
          headerValue = value;
        }
      },
      statusCode: 200,
    };

    performanceMonitor(req, res, () => {});
    res.end();

    assert.ok(headerSet);
    assert.ok(headerValue.includes('ms'));
  });
});
