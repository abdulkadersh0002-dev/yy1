/**
 * Unit tests for EA Bridge bar window storage
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EaBridgeService from '../../../src/services/brokers/ea-bridge-service.js';

describe('EaBridgeService market bars', () => {
  it('records and retrieves bars with rolling window', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    const nowSec = Math.trunc(Date.now() / 1000);
    const ingest = svc.recordMarketBars({
      broker: 'mt5',
      symbol: 'EURUSD',
      timeframe: 'M15',
      bars: [
        { time: nowSec - 900, open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 10 },
        { time: nowSec, open: 1.15, high: 1.18, low: 1.14, close: 1.17, volume: 12 }
      ]
    });

    assert.equal(ingest.success, true);
    assert.equal(ingest.recorded, 2);

    const bars = svc.getMarketBars({ broker: 'mt5', symbol: 'EURUSD', timeframe: 'M15', limit: 5 });
    assert.equal(Array.isArray(bars), true);
    assert.equal(bars.length, 2);

    // newest-first
    assert.ok(bars[0].time >= bars[1].time);
    assert.equal(bars[0].close, 1.17);
  });

  it('rejects unsupported timeframes', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    const ingest = svc.recordMarketBars({
      broker: 'mt5',
      symbol: 'EURUSD',
      timeframe: 'H2',
      bars: [{ time: Date.now(), open: 1.1, high: 1.2, low: 1.0, close: 1.15 }]
    });

    assert.equal(ingest.success, false);
    assert.match(String(ingest.message), /Unsupported timeframe/i);
  });

  it('builds free candles from quotes for active symbols (alias suffix supported)', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });

    // Mark BTCEUR as active (dashboard behavior).
    svc.setActiveSymbols({ broker: 'mt5', symbols: ['BTCEUR'], ttlMs: 60_000 });

    const base = Date.UTC(2026, 0, 10, 10, 0, 0);
    // Broker streams BTCEURm; server should still build candles for requested BTCEUR.
    svc.recordQuotes({
      broker: 'mt5',
      quotes: [
        { symbol: 'BTCEURm', bid: 40000, ask: 40010, timestamp: base + 1_000 },
        { symbol: 'BTCEURm', bid: 40100, ask: 40110, timestamp: base + 20_000 },
        { symbol: 'BTCEURm', bid: 39900, ask: 39910, timestamp: base + 40_000 }
      ]
    });

    const candles = svc.getMarketCandles({
      broker: 'mt5',
      symbol: 'BTCEUR',
      timeframe: 'M1',
      allowSynthetic: true
    });
    assert.ok(Array.isArray(candles));
    assert.ok(candles.length >= 1);
    assert.equal(Number(candles[0].open) > 0, true);
    assert.equal(Number(candles[0].high) >= Number(candles[0].low), true);
  });
});
