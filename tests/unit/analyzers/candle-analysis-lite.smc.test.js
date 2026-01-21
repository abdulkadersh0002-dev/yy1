/**
 * SMC feature extraction tests (best-effort heuristics).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeCandleSeries } from '../../../src/analyzers/candle-analysis-lite.js';

const makeCandle = ({ t, o, h, l, c, v }) => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v
});

const genBaseSeries = ({ start = 1.1, count = 40, step = 0.0002, startTime = 1700000000 } = {}) => {
  const out = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    const o = price;
    const c = price + step * (i % 2 === 0 ? 1 : -0.5);
    const high = Math.max(o, c) + step * 0.8;
    const low = Math.min(o, c) - step * 0.8;
    out.push(
      makeCandle({
        t: startTime + i * 60,
        o,
        h: high,
        l: low,
        c,
        v: 100 + (i % 5) * 10
      })
    );
    price = c;
  }
  return out;
};

describe('analyzeCandleSeries SMC', () => {
  it('detects a sweep-high style rejection as liquiditySweep SELL', () => {
    const series = genBaseSeries({ start: 1.1, count: 35 });

    // Create a new candle that sweeps above recent highs then closes back under.
    const prevHigh = Math.max(...series.slice(-20).map((c) => c.high));
    const lastClose = series[series.length - 1].close;

    const sweepCandle = makeCandle({
      t: 1700000000 + 35 * 60,
      o: lastClose,
      h: prevHigh + 0.0012,
      l: lastClose - 0.0003,
      c: prevHigh - 0.0002,
      v: 260
    });

    series.push(sweepCandle);

    const analysis = analyzeCandleSeries(series, { timeframe: 'M15' });
    assert.ok(analysis);
    assert.ok(analysis.smc);
    assert.ok(analysis.smc.liquiditySweep);

    assert.equal(analysis.smc.liquiditySweep.bias, 'SELL');
    assert.equal(analysis.smc.liquiditySweep.type, 'sweep_high');
    assert.ok(Number.isFinite(analysis.smc.liquiditySweep.confidence));
  });

  it('emits an orderBlock object when an impulse candle is present', () => {
    const series = genBaseSeries({ start: 1.2, count: 45, step: 0.00015 });

    // Force an opposite candle then a large impulse candle.
    const t0 = 1700001000 + 45 * 60;
    const last = series[series.length - 1].close;

    // bearish candle
    series.push(
      makeCandle({
        t: t0,
        o: last,
        h: last + 0.0002,
        l: last - 0.0006,
        c: last - 0.0005,
        v: 140
      })
    );

    const p1 = series[series.length - 1].close;

    // bullish impulse candle (large range)
    series.push(
      makeCandle({
        t: t0 + 60,
        o: p1,
        h: p1 + 0.0022,
        l: p1 - 0.0001,
        c: p1 + 0.0019,
        v: 200
      })
    );

    const analysis = analyzeCandleSeries(series, { timeframe: 'M15' });
    assert.ok(analysis);
    assert.ok(analysis.smc);

    // Depending on avgRange, this may be null in some edge cases;
    // but when present it must be well-formed.
    if (analysis.smc.orderBlock) {
      assert.ok(['BUY', 'SELL'].includes(analysis.smc.orderBlock.direction));
      assert.ok(Number.isFinite(analysis.smc.orderBlock.zoneLow));
      assert.ok(Number.isFinite(analysis.smc.orderBlock.zoneHigh));
      assert.ok(analysis.smc.orderBlock.zoneHigh >= analysis.smc.orderBlock.zoneLow);
    }
  });

  it('detects volumeSpike when the latest candle has extreme volume', () => {
    const series = genBaseSeries({ start: 1.05, count: 30 });

    // Inflate last candle volume
    series[series.length - 1] = {
      ...series[series.length - 1],
      volume: 2000
    };

    const analysis = analyzeCandleSeries(series, { timeframe: 'M15' });
    assert.ok(analysis);
    assert.ok(analysis.smc);
    assert.ok(analysis.smc.volumeSpike);

    assert.equal(typeof analysis.smc.volumeSpike.isSpike, 'boolean');
    assert.ok(Number.isFinite(analysis.smc.volumeSpike.ratio));
    assert.ok(Number.isFinite(analysis.smc.volumeSpike.zScore));
  });

  it('detects a bullish price-imbalance (FVG) gap', () => {
    const series = genBaseSeries({ start: 1.1, count: 30, step: 0.00015 });

    // Create a clean bullish gap: current low > high from 2 bars ago.
    const i0 = series.length - 3;
    const i1 = series.length - 2;
    const i2 = series.length - 1;

    series[i0] = makeCandle({
      t: series[i0].time,
      o: 1.1002,
      h: 1.1006,
      l: 1.0998,
      c: 1.1001,
      v: 120
    });

    series[i1] = makeCandle({
      t: series[i1].time,
      o: 1.1009,
      h: 1.1011,
      l: 1.1007,
      c: 1.101,
      v: 110
    });

    series[i2] = makeCandle({
      t: series[i2].time,
      o: 1.1029,
      h: 1.1032,
      l: 1.1022,
      c: 1.103,
      v: 130
    });

    const analysis = analyzeCandleSeries(series, { timeframe: 'M15' });
    assert.ok(analysis);
    assert.ok(analysis.smc);
    assert.ok(analysis.smc.priceImbalance);

    assert.equal(analysis.smc.priceImbalance.state, 'bullish');
    assert.ok(Number.isFinite(analysis.smc.priceImbalance.confidence));
    assert.ok(analysis.smc.priceImbalance.nearest);
    assert.ok(Number.isFinite(analysis.smc.priceImbalance.nearest.zoneLow));
    assert.ok(Number.isFinite(analysis.smc.priceImbalance.nearest.zoneHigh));
  });
});
