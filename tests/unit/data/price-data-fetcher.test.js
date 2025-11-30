import test from 'node:test';
import assert from 'node:assert/strict';
import PriceDataFetcher from '../../../src/data/price-data-fetcher.js';

function createFetcher(options = {}) {
  return new PriceDataFetcher(
    {},
    {
      allowUnconfiguredProviders: true,
      ...options
    }
  );
}

test('recordRequest records latency, success, and quality metrics', () => {
  const fetcher = createFetcher();
  fetcher.recordRequest('twelveData', { success: true, latencyMs: 200, qualityScore: 0.82 });

  const metrics = fetcher.metrics.providers.twelveData;
  assert.equal(metrics.success, 1);
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.avgLatencyMs, 200);
  assert.equal(metrics.normalizedQuality, 0.82);
  assert.equal(metrics.healthStatus, 'healthy');
});

test('recordRequest triggers circuit breaker after repeated failures', () => {
  const fetcher = createFetcher({ failureThreshold: 2, failureCooldownMs: 60_000 });

  fetcher.recordRequest('polygon', { success: false, qualityScore: 0.9 });
  fetcher.recordRequest('polygon', { success: false, qualityScore: 0.9 });

  const metrics = fetcher.metrics.providers.polygon;
  assert.equal(metrics.consecutiveFailures, 2);
  assert.ok(metrics.circuitBreaker, 'circuit breaker should activate');
  assert.equal(metrics.circuitBreaker.reason, 'failures');
  assert.equal(fetcher.getProviderHealthEntry('polygon').status, 'blocked');
});

test('getProviderOrder prefers healthy providers over blocked ones', () => {
  const fetcher = createFetcher();

  fetcher.metrics.providers.twelveData.success = 20;
  fetcher.metrics.providers.twelveData.failed = 2;
  fetcher.metrics.providers.twelveData.normalizedQuality = 0.95;

  fetcher.metrics.providers.polygon.success = 1;
  fetcher.metrics.providers.polygon.failed = 12;
  fetcher.metrics.providers.polygon.circuitBreaker = {
    reason: 'failures',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };

  const order = fetcher.getProviderOrder('M15');
  assert.equal(order[0], 'twelveData');
  assert.ok(order.indexOf('polygon') > order.indexOf('twelveData'));
});

test('isDataFetchViable returns false when all providers are disabled', () => {
  const fetcher = createFetcher();
  ['twelvedata', 'polygon', 'finnhub', 'alphavantage'].forEach((name) => {
    fetcher.disabledProviders.add(name);
  });

  const assessment = fetcher.isDataFetchViable('M15');
  assert.equal(assessment.viable, false);
  assert.ok(assessment.reasons.includes('no_providers'));
  assert.equal(assessment.availableProviders.length, 0);
});
