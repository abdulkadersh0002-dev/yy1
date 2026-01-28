/**
 * Tests for Query Performance Tracker
 * 
 * Tests query performance monitoring, statistics tracking,
 * slow query detection, and metrics aggregation.
 * 
 * Part of 64 improvements roadmap - Improvement #5
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { QueryPerformanceTracker } from '../../../src/infrastructure/storage/query-performance-tracker.js';

describe('Query Performance Tracker', () => {
  let tracker;

  before(() => {
    tracker = new QueryPerformanceTracker();
    tracker.setSlowQueryThreshold(50); // Lower threshold for testing
  });

  after(() => {
    tracker.reset();
  });

  it('should track query execution', () => {
    tracker.trackQuery('test_query', 'SELECT * FROM users', 25, []);
    
    const stats = tracker.getStats('test_query');
    assert(stats !== null);
    assert(stats.test_query.count === 1);
    assert(stats.test_query.avgDuration === 25);
  });

  it('should update statistics on multiple executions', () => {
    tracker.reset();
    tracker.trackQuery('repeat_query', 'SELECT * FROM users', 10, []);
    tracker.trackQuery('repeat_query', 'SELECT * FROM users', 20, []);
    tracker.trackQuery('repeat_query', 'SELECT * FROM users', 30, []);
    
    const stats = tracker.getStats('repeat_query');
    assert(stats.repeat_query.count === 3);
    assert(stats.repeat_query.minDuration === 10);
    assert(stats.repeat_query.maxDuration === 30);
    assert(stats.repeat_query.avgDuration === 20);
  });

  it('should detect slow queries', () => {
    tracker.reset();
    tracker.trackQuery('slow_query', 'SELECT * FROM large_table', 100, [1, 2]);
    
    const slowQueries = tracker.getSlowQueries();
    assert(slowQueries.length === 1);
    assert(slowQueries[0].queryName === 'slow_query');
    assert(slowQueries[0].duration === 100);
  });

  it('should return top slowest queries', () => {
    tracker.reset();
    tracker.trackQuery('fast_query', 'SELECT 1', 5, []);
    tracker.trackQuery('medium_query', 'SELECT * FROM users', 25, []);
    tracker.trackQuery('slow_query', 'SELECT * FROM orders', 100, []);
    
    const topSlowest = tracker.getTopSlowestQueries(2);
    assert(topSlowest.length === 2);
    assert(topSlowest[0].queryName === 'slow_query');
    assert(topSlowest[1].queryName === 'medium_query');
  });

  it('should return most frequent queries', () => {
    tracker.reset();
    tracker.trackQuery('frequent', 'SELECT 1', 5, []);
    tracker.trackQuery('frequent', 'SELECT 1', 5, []);
    tracker.trackQuery('frequent', 'SELECT 1', 5, []);
    tracker.trackQuery('rare', 'SELECT 2', 5, []);
    
    const mostFrequent = tracker.getMostFrequentQueries(2);
    assert(mostFrequent.length === 2);
    assert(mostFrequent[0].queryName === 'frequent');
    assert(mostFrequent[0].stats.count === 3);
  });

  it('should provide comprehensive summary', () => {
    tracker.reset();
    tracker.trackQuery('query1', 'SELECT 1', 10, []);
    tracker.trackQuery('query2', 'SELECT 2', 20, []);
    tracker.trackQuery('query3', 'SELECT 3', 100, []); // Slow query
    
    const summary = tracker.getSummary();
    assert(summary.queries.total === 3);
    assert(summary.queries.unique === 3);
    assert(summary.slowQueries.count === 1);
    assert(Array.isArray(summary.topSlowest));
    assert(Array.isArray(summary.mostFrequent));
  });

  it('should truncate long queries', () => {
    const longQuery = 'SELECT ' + 'a,'.repeat(200) + ' FROM table';
    tracker.trackQuery('long_query', longQuery, 100, []);
    
    const slowQueries = tracker.getSlowQueries();
    const trackedQuery = slowQueries.find(q => q.queryName === 'long_query');
    assert(trackedQuery.queryText.length <= 203); // 200 + '...'
  });

  it('should sanitize long parameters', () => {
    const longParam = 'x'.repeat(100);
    tracker.trackQuery('param_query', 'SELECT * FROM users WHERE name = $1', 100, [longParam]);
    
    const slowQueries = tracker.getSlowQueries();
    const query = slowQueries.find(q => q.queryName === 'param_query');
    assert(query.params[0].length <= 53); // 50 + '...'
  });

  it('should reset statistics', () => {
    tracker.trackQuery('test', 'SELECT 1', 10, []);
    assert(tracker.queryStats.size > 0);
    
    tracker.reset();
    assert(tracker.queryStats.size === 0);
    assert(tracker.slowQueries.length === 0);
  });

  it('should limit stored slow queries', () => {
    tracker.reset();
    tracker.maxSlowQueries = 5;
    
    for (let i = 0; i < 10; i++) {
      tracker.trackQuery(`query${i}`, 'SELECT 1', 100, []);
    }
    
    assert(tracker.slowQueries.length <= 5);
  });

  it('should handle stats for non-existent query', () => {
    const stats = tracker.getStats('non_existent_query');
    assert(stats === null);
  });

  it('should update slow query threshold', () => {
    tracker.setSlowQueryThreshold(200);
    assert(tracker.slowQueryThreshold === 200);
    
    tracker.reset();
    tracker.trackQuery('query', 'SELECT 1', 150, []); // Below new threshold
    assert(tracker.slowQueries.length === 0);
  });
});
