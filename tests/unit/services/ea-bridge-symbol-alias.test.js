/**
 * Unit tests for EA Bridge symbol aliasing (EURUSD vs EURUSDm etc)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EaBridgeService from '../../../src/services/brokers/ea-bridge-service.js';

describe('EaBridgeService symbol aliasing', () => {
  it('resolves snapshot requests to broker-available symbol (quotes-driven)', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    // Simulate EA terminal symbols with suffix by recording a quote for EURUSDm.
    svc.recordQuotes({
      broker: 'mt5',
      quotes: [{ symbol: 'EURUSDm', bid: 1.1, ask: 1.1002, timestamp: Date.now() }]
    });

    // Dashboard will often request normalized symbol EURUSD.
    const req = svc.requestMarketSnapshot({ broker: 'mt5', symbol: 'EURUSD', ttlMs: 30_000 });

    assert.equal(req.success, true);
    assert.equal(req.broker, 'mt5');
    assert.equal(req.symbol, 'EURUSDM');

    const pending = svc.consumeMarketSnapshotRequests({ broker: 'mt5', max: 10 });
    assert.deepEqual(pending, ['EURUSDM']);
  });

  it('retrieves snapshots using alias match (EURUSD -> EURUSDm)', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    svc.recordMarketSnapshot({
      broker: 'mt5',
      symbol: 'EURUSDm',
      timestamp: Date.now(),
      timeframes: {
        M15: {
          direction: 'BUY',
          score: 80,
          indicators: { rsi: { value: 60 }, macd: { histogram: 0.0001 }, atr: { value: 0.001 } },
          lastPrice: 1.1,
          latestCandle: {
            open: 1.0,
            high: 1.2,
            low: 0.9,
            close: 1.1,
            time: Math.trunc(Date.now() / 1000)
          }
        }
      }
    });

    const snap = svc.getMarketSnapshot({ broker: 'mt5', symbol: 'EURUSD' });
    assert.ok(snap);
    assert.equal(snap.symbol, 'EURUSDM');
    assert.ok(snap.timeframes);
  });

  it('retrieves bars using alias match (EURUSD -> EURUSDm) for same timeframe', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    const nowSec = Math.trunc(Date.now() / 1000);
    svc.recordMarketBars({
      broker: 'mt5',
      symbol: 'EURUSDm',
      timeframe: 'M1',
      bars: [{ time: nowSec, open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 10 }]
    });

    const bars = svc.getMarketBars({ broker: 'mt5', symbol: 'EURUSD', timeframe: 'M1', limit: 1 });
    assert.equal(Array.isArray(bars), true);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].close, 1.15);
  });

  it('does not enqueue snapshot requests when a fresh snapshot exists', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    svc.recordMarketSnapshot({
      broker: 'mt5',
      symbol: 'EURUSD',
      timestamp: Date.now(),
      timeframes: { M15: { direction: 'BUY', score: 80, indicators: { rsi: { value: 60 } } } }
    });

    const req = svc.requestMarketSnapshot({ broker: 'mt5', symbol: 'EURUSD', ttlMs: 30_000 });
    assert.equal(req.success, true);
    assert.equal(req.message, 'Snapshot already fresh');

    const pending = svc.consumeMarketSnapshotRequests({ broker: 'mt5', max: 10 });
    assert.deepEqual(pending, []);
  });

  it('de-dupes snapshot requests while a symbol is in flight', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    const first = svc.requestMarketSnapshot({ broker: 'mt5', symbol: 'EURUSD', ttlMs: 30_000 });
    assert.equal(first.success, true);

    const pending = svc.consumeMarketSnapshotRequests({ broker: 'mt5', max: 10 });
    assert.deepEqual(pending, ['EURUSD']);

    const second = svc.requestMarketSnapshot({ broker: 'mt5', symbol: 'EURUSD', ttlMs: 30_000 });
    assert.equal(second.success, true);
    assert.equal(second.message, 'Snapshot already in flight');

    const pendingAfter = svc.consumeMarketSnapshotRequests({ broker: 'mt5', max: 10 });
    assert.deepEqual(pendingAfter, []);
  });
});
