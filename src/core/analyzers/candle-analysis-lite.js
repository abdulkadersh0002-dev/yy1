const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeTimeMs = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  // Heuristic: epoch seconds -> ms
  return num < 10_000_000_000 ? Math.round(num * 1000) : Math.round(num);
};

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const computeStdDev = (values) => {
  const nums = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  if (nums.length < 3) {
    return null;
  }
  const mean = nums.reduce((sum, v) => sum + v, 0) / nums.length;
  const variance = nums.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / nums.length;
  return Math.sqrt(Math.max(0, variance));
};

const computeRsi = (closes, period = 14) => {
  const values = Array.isArray(closes) ? closes.filter((v) => Number.isFinite(v)) : [];
  if (values.length < period + 2) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  for (let i = values.length - period - 1; i < values.length - 1; i += 1) {
    const delta = values[i + 1] - values[i];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const computeAtr = (candles, period = 14) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < period + 2) {
    return null;
  }

  const trs = [];
  for (let i = Math.max(1, series.length - period - 1); i < series.length; i += 1) {
    const curr = series[i];
    const prev = series[i - 1];
    const high = safeNumber(curr?.high);
    const low = safeNumber(curr?.low);
    const prevClose = safeNumber(prev?.close);
    if (high == null || low == null || prevClose == null) {
      continue;
    }

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (Number.isFinite(tr)) {
      trs.push(tr);
    }
  }

  if (trs.length < Math.max(6, Math.floor(period * 0.6))) {
    return null;
  }

  return trs.reduce((sum, v) => sum + v, 0) / trs.length;
};

const computeRegression = (closes, maxPoints = 30) => {
  const values = Array.isArray(closes) ? closes.filter((v) => Number.isFinite(v)) : [];
  if (values.length < 8) {
    return null;
  }

  const n = Math.min(maxPoints, values.length);
  const y = values.slice(values.length - n);
  const m = y.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < m; i += 1) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }

  const denom = m * sumXX - sumX * sumX;
  if (denom === 0) {
    return null;
  }

  const slope = (m * sumXY - sumX * sumY) / denom;
  const meanY = sumY / m;
  const intercept = meanY - (slope * sumX) / m;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < m; i += 1) {
    const yi = y[i];
    const yhat = intercept + slope * i;
    ssTot += (yi - meanY) * (yi - meanY);
    ssRes += (yi - yhat) * (yi - yhat);
  }

  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;
  return { slope, r2 };
};

const computeVolumeImbalance = (candles, lookback = 20) => {
  const series = Array.isArray(candles) ? candles : [];
  const slice = series.slice(Math.max(0, series.length - lookback));
  if (slice.length < 6) {
    return null;
  }

  let upVol = 0;
  let downVol = 0;
  let totalVol = 0;
  let missing = 0;
  for (const c of slice) {
    const vol = safeNumber(c?.volume);
    if (vol == null) {
      missing += 1;
      continue;
    }
    totalVol += vol;
    if (c.close >= c.open) {
      upVol += vol;
    } else {
      downVol += vol;
    }
  }

  if (totalVol <= 0 || missing > Math.floor(slice.length * 0.6)) {
    return null;
  }

  const imbalance = (upVol - downVol) / totalVol;
  const minAbs = envNumber('SMC_VOL_IMBALANCE_MIN_ABS', 0.12);
  const state = imbalance > minAbs ? 'buying' : imbalance < -minAbs ? 'selling' : 'neutral';
  return {
    imbalance: Number(imbalance.toFixed(4)),
    pressurePct: Number((imbalance * 100).toFixed(2)),
    state,
    sampleSize: slice.length
  };
};

const detectLiquiditySweep = (candles, { lookback = 20, atr = null } = {}) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < lookback + 2) {
    return null;
  }

  const prev = series.slice(series.length - 1 - lookback, series.length - 1);
  const prevHigh = Math.max(...prev.map((c) => safeNumber(c?.high)).filter((v) => v != null));
  const prevLow = Math.min(...prev.map((c) => safeNumber(c?.low)).filter((v) => v != null));
  if (!Number.isFinite(prevHigh) || !Number.isFinite(prevLow)) {
    return null;
  }

  const curr = series[series.length - 1];
  const o = safeNumber(curr?.open);
  const h = safeNumber(curr?.high);
  const l = safeNumber(curr?.low);
  const c = safeNumber(curr?.close);
  if ([o, h, l, c].some((v) => v == null)) {
    return null;
  }

  const body = Math.abs(c - o);
  const range = Math.max(1e-9, h - l);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;

  const wickRatioUpper = upperWick / Math.max(1e-9, body);
  const wickRatioLower = lowerWick / Math.max(1e-9, body);

  const atrValue = Number.isFinite(Number(atr)) ? Number(atr) : null;

  const sweepWickToBodyMin = envNumber('SMC_SWEEP_WICK_BODY_MIN', 1.4);
  const sweepWickToRangeMin = envNumber('SMC_SWEEP_WICK_RANGE_MIN', 0.35);
  const sweepAtrDiv = envNumber('SMC_SWEEP_ATR_DIV', 0.6);

  // Sweep high (stop-hunt above highs) -> bearish rejection bias.
  if (
    h > prevHigh &&
    c < prevHigh &&
    upperWick >= body * sweepWickToBodyMin &&
    upperWick / range >= sweepWickToRangeMin
  ) {
    const sweptBy = h - prevHigh;
    const rejection = prevHigh - c;
    const atrFactor =
      atrValue && atrValue > 0 ? clamp(sweptBy / (atrValue * sweepAtrDiv), 0, 1) : 0.45;
    const wickFactor = clamp((wickRatioUpper - 1) / 3, 0, 1);
    const confidence = clamp(Math.round((atrFactor * 0.55 + wickFactor * 0.45) * 100), 0, 100);
    return {
      type: 'sweep_high',
      bias: 'SELL',
      level: Number(prevHigh.toFixed(8)),
      sweptBy: Number(sweptBy.toFixed(8)),
      rejection: Number(rejection.toFixed(8)),
      wickRatio: Number(wickRatioUpper.toFixed(2)),
      confidence
    };
  }

  // Sweep low (stop-hunt below lows) -> bullish rejection bias.
  if (
    l < prevLow &&
    c > prevLow &&
    lowerWick >= body * sweepWickToBodyMin &&
    lowerWick / range >= sweepWickToRangeMin
  ) {
    const sweptBy = prevLow - l;
    const rejection = c - prevLow;
    const atrFactor =
      atrValue && atrValue > 0 ? clamp(sweptBy / (atrValue * sweepAtrDiv), 0, 1) : 0.45;
    const wickFactor = clamp((wickRatioLower - 1) / 3, 0, 1);
    const confidence = clamp(Math.round((atrFactor * 0.55 + wickFactor * 0.45) * 100), 0, 100);
    return {
      type: 'sweep_low',
      bias: 'BUY',
      level: Number(prevLow.toFixed(8)),
      sweptBy: Number(sweptBy.toFixed(8)),
      rejection: Number(rejection.toFixed(8)),
      wickRatio: Number(wickRatioLower.toFixed(2)),
      confidence
    };
  }

  return null;
};

const detectOrderBlock = (candles, { atr = null, lookback = 40, impulseLookback = 12 } = {}) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < 14) {
    return null;
  }

  const window = series.slice(Math.max(0, series.length - lookback));
  const ranges = window
    .map((c) => {
      const h = safeNumber(c?.high);
      const l = safeNumber(c?.low);
      return h != null && l != null ? h - l : null;
    })
    .filter((v) => v != null);
  if (ranges.length < 10) {
    return null;
  }

  const avgRange = ranges.reduce((sum, v) => sum + v, 0) / Math.max(1, ranges.length);
  const atrValue = Number.isFinite(Number(atr)) ? Number(atr) : null;

  const impulseRangeMult = envNumber('SMC_OB_IMPULSE_RANGE_MULT', 1.8);
  const impulseBodyFracMin = envNumber('SMC_OB_IMPULSE_BODY_FRAC_MIN', 0.55);
  const obNearAtrFrac = envNumber('SMC_OB_NEAR_ATR_FRAC', 0.35);

  // Find a recent impulse candle.
  const start = Math.max(1, window.length - impulseLookback);
  for (let i = window.length - 1; i >= start; i -= 1) {
    const curr = window[i];
    const prev = window[i - 1];
    const o = safeNumber(curr?.open);
    const c = safeNumber(curr?.close);
    const h = safeNumber(curr?.high);
    const l = safeNumber(curr?.low);
    if ([o, c, h, l].some((v) => v == null)) {
      continue;
    }
    const range = h - l;
    const body = Math.abs(c - o);
    if (
      !(range > avgRange * impulseRangeMult && body / Math.max(1e-9, range) >= impulseBodyFracMin)
    ) {
      continue;
    }

    const impulseDir = c > o ? 'BUY' : c < o ? 'SELL' : 'NEUTRAL';
    if (impulseDir === 'NEUTRAL') {
      continue;
    }
    const pO = safeNumber(prev?.open);
    const pC = safeNumber(prev?.close);
    const pH = safeNumber(prev?.high);
    const pL = safeNumber(prev?.low);
    if ([pO, pC, pH, pL].some((v) => v == null)) {
      continue;
    }

    // Order block: last opposite candle before the impulse.
    const prevDir = pC > pO ? 'BUY' : pC < pO ? 'SELL' : 'NEUTRAL';
    if (prevDir === 'NEUTRAL' || prevDir === impulseDir) {
      continue;
    }

    const zoneLow = Math.min(pO, pC, pL);
    const zoneHigh = Math.max(pO, pC, pH);
    const newest = window[window.length - 1];
    const price = safeNumber(newest?.close);
    const dist =
      price == null
        ? null
        : price >= zoneLow && price <= zoneHigh
          ? 0
          : Math.min(Math.abs(price - zoneLow), Math.abs(price - zoneHigh));
    const near =
      dist == null || atrValue == null || atrValue <= 0
        ? null
        : dist <= Math.max(atrValue * obNearAtrFrac, 1e-9);

    const impulseRatio = avgRange > 0 ? range / avgRange : null;
    const impulseFactor = impulseRatio == null ? 0.55 : clamp((impulseRatio - 1.6) / 1.4, 0, 1);
    const proximityFactor = near == null ? 0.35 : near ? 1 : 0;
    const confidence = clamp(
      Math.round((impulseFactor * 0.65 + proximityFactor * 0.35) * 100),
      0,
      100
    );

    const barsFromLast = window.length - 1 - (i - 1);

    return {
      direction: impulseDir,
      zoneLow: Number(zoneLow.toFixed(8)),
      zoneHigh: Number(zoneHigh.toFixed(8)),
      distance: dist != null ? Number(dist.toFixed(8)) : null,
      near,
      impulseRatio: impulseRatio != null ? Number(impulseRatio.toFixed(2)) : null,
      ageBars: barsFromLast,
      confidence
    };
  }

  return null;
};

const detectVolumeSpike = (candles, lookback = 20) => {
  const series = Array.isArray(candles) ? candles : [];
  const slice = series.slice(Math.max(0, series.length - lookback));
  const vols = slice.map((c) => safeNumber(c?.volume)).filter((v) => v != null && v > 0);
  if (vols.length < 8) {
    return null;
  }
  const last = vols[vols.length - 1];
  const avg = vols.reduce((sum, v) => sum + v, 0) / Math.max(1, vols.length);
  const variance =
    vols.reduce((sum, v) => sum + (v - avg) * (v - avg), 0) / Math.max(1, vols.length);
  const std = Math.sqrt(Math.max(0, variance));
  const z = std > 0 ? (last - avg) / std : 0;
  const ratio = avg > 0 ? last / avg : 1;
  const ratioMin = envNumber('SMC_VOL_RATIO_MIN', 1.8);
  const zMin = envNumber('SMC_VOL_Z_MIN', 1.5);
  const isSpike = ratio >= ratioMin && z >= zMin;
  return {
    newest: Number(last.toFixed(2)),
    average: Number(avg.toFixed(2)),
    zScore: Number(z.toFixed(2)),
    ratio: Number(ratio.toFixed(2)),
    isSpike
  };
};

const detectPriceImbalance = (candles, { lookback = 30, atr = null } = {}) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < 6) {
    return null;
  }

  const atrValue = Number.isFinite(Number(atr)) ? Number(atr) : null;
  const minAtrFrac = envNumber('SMC_FVG_MIN_ATR_FRAC', 0.15);
  const maxAgeBars = Math.max(3, Math.floor(envNumber('SMC_FVG_MAX_AGE_BARS', 25)));

  const newest = series[series.length - 1];
  const price = safeNumber(newest?.close);
  if (price == null) {
    return null;
  }

  const start = Math.max(2, series.length - Math.max(6, lookback));
  const gaps = [];

  for (let i = series.length - 1; i >= start; i -= 1) {
    const c0 = series[i - 2];
    const c2 = series[i];
    const h0 = safeNumber(c0?.high);
    const l0 = safeNumber(c0?.low);
    const h2 = safeNumber(c2?.high);
    const l2 = safeNumber(c2?.low);
    const t2 = safeNumber(c2?.timeMs);
    if ([h0, l0, h2, l2].some((v) => v == null)) {
      continue;
    }

    // Bullish FVG: current low > high from 2 bars ago
    if (l2 > h0) {
      const zoneLow = h0;
      const zoneHigh = l2;
      const size = zoneHigh - zoneLow;
      if (atrValue && atrValue > 0 && size < atrValue * minAtrFrac) {
        continue;
      }

      const after = series.slice(i + 1);
      const minLowAfter = after
        .map((c) => safeNumber(c?.low))
        .filter((v) => v != null)
        .reduce((acc, v) => Math.min(acc, v), Number.POSITIVE_INFINITY);

      const clamped = Number.isFinite(minLowAfter)
        ? clamp(minLowAfter, zoneLow, zoneHigh)
        : zoneHigh;
      const fillDepth = zoneHigh - clamped;
      const fillPct = size > 0 ? clamp((fillDepth / size) * 100, 0, 100) : 0;

      gaps.push({
        type: 'bullish',
        zoneLow: Number(zoneLow.toFixed(8)),
        zoneHigh: Number(zoneHigh.toFixed(8)),
        size: Number(size.toFixed(8)),
        fillPct: Number(fillPct.toFixed(1)),
        createdAt: t2 != null ? Number(t2) : null,
        ageBars: series.length - 1 - i
      });
    }

    // Bearish FVG: current high < low from 2 bars ago
    if (h2 < l0) {
      const zoneLow = h2;
      const zoneHigh = l0;
      const size = zoneHigh - zoneLow;
      if (atrValue && atrValue > 0 && size < atrValue * minAtrFrac) {
        continue;
      }

      const after = series.slice(i + 1);
      const maxHighAfter = after
        .map((c) => safeNumber(c?.high))
        .filter((v) => v != null)
        .reduce((acc, v) => Math.max(acc, v), Number.NEGATIVE_INFINITY);

      const clamped = Number.isFinite(maxHighAfter)
        ? clamp(maxHighAfter, zoneLow, zoneHigh)
        : zoneLow;
      const fillDepth = clamped - zoneLow;
      const fillPct = size > 0 ? clamp((fillDepth / size) * 100, 0, 100) : 0;

      gaps.push({
        type: 'bearish',
        zoneLow: Number(zoneLow.toFixed(8)),
        zoneHigh: Number(zoneHigh.toFixed(8)),
        size: Number(size.toFixed(8)),
        fillPct: Number(fillPct.toFixed(1)),
        createdAt: t2 != null ? Number(t2) : null,
        ageBars: series.length - 1 - i
      });
    }

    if (gaps.length >= 10) {
      break;
    }
  }

  const recent = gaps.filter((g) => (g.ageBars ?? 999) <= maxAgeBars);
  if (!recent.length) {
    return { state: 'none', gaps: [], nearest: null, confidence: 0 };
  }

  const distanceToGap = (g) => {
    const low = Number(g.zoneLow);
    const high = Number(g.zoneHigh);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return null;
    }
    if (price >= low && price <= high) {
      return 0;
    }
    return Math.min(Math.abs(price - low), Math.abs(price - high));
  };

  const candidates = recent
    .filter((g) => Number(g.fillPct) < 100)
    .map((g) => ({ g, d: distanceToGap(g) }))
    .filter((x) => x.d != null)
    .sort((a, b) => a.d - b.d);

  const nearest = candidates.length ? candidates[0].g : recent[0];
  const state = nearest?.type || 'none';
  const dist = distanceToGap(nearest);

  const atrFactor =
    atrValue && atrValue > 0 && dist != null ? clamp(1 - dist / (atrValue * 1.2), 0, 1) : 0.45;
  const unfilled = clamp(1 - (Number(nearest?.fillPct) || 0) / 100, 0, 1);
  const confidence = clamp(Math.round((atrFactor * 0.55 + unfilled * 0.45) * 100), 0, 100);

  return {
    state,
    gaps: recent.slice(0, 10),
    nearest: nearest
      ? {
          type: nearest.type,
          zoneLow: nearest.zoneLow,
          zoneHigh: nearest.zoneHigh,
          size: nearest.size,
          fillPct: nearest.fillPct,
          ageBars: nearest.ageBars,
          distance: dist != null ? Number(dist.toFixed(8)) : null
        }
      : null,
    confidence
  };
};

const detectStructure = (candles, lookback = 8) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < 6) {
    return null;
  }

  const slice = series.slice(Math.max(0, series.length - lookback));
  const highs = slice.map((c) => safeNumber(c?.high)).filter((v) => v != null);
  const lows = slice.map((c) => safeNumber(c?.low)).filter((v) => v != null);
  if (highs.length < 4 || lows.length < 4) {
    return null;
  }

  let hh = 0;
  let hl = 0;
  let lh = 0;
  let ll = 0;
  for (let i = 1; i < highs.length; i += 1) {
    if (highs[i] > highs[i - 1]) {
      hh += 1;
    } else if (highs[i] < highs[i - 1]) {
      lh += 1;
    }

    if (lows[i] > lows[i - 1]) {
      hl += 1;
    } else if (lows[i] < lows[i - 1]) {
      ll += 1;
    }
  }

  const score = hh + hl - (lh + ll);
  const bias = score >= 2 ? 'BUY' : score <= -2 ? 'SELL' : 'NEUTRAL';
  const confidence = clamp((Math.abs(score) / (highs.length - 1)) * 100, 0, 100);
  const state = bias === 'BUY' ? 'hh_hl' : bias === 'SELL' ? 'll_lh' : 'mixed';

  return { bias, confidence: Number(confidence.toFixed(0)), state, score };
};

const detectPatterns = (candles) => {
  const series = Array.isArray(candles) ? candles : [];
  if (series.length < 2) {
    return [];
  }

  const prev = series[series.length - 2];
  const curr = series[series.length - 1];

  const o1 = safeNumber(prev?.open);
  const c1 = safeNumber(prev?.close);
  const h1 = safeNumber(prev?.high);
  const l1 = safeNumber(prev?.low);

  const o2 = safeNumber(curr?.open);
  const c2 = safeNumber(curr?.close);
  const h2 = safeNumber(curr?.high);
  const l2 = safeNumber(curr?.low);

  if ([o1, c1, h1, l1, o2, c2, h2, l2].some((v) => v == null)) {
    return [];
  }

  const patterns = [];

  const prevBull = c1 > o1;
  const prevBear = c1 < o1;
  const currBull = c2 > o2;
  const currBear = c2 < o2;

  const prevBodyMin = Math.min(o1, c1);
  const prevBodyMax = Math.max(o1, c1);
  const currBodyMin = Math.min(o2, c2);
  const currBodyMax = Math.max(o2, c2);

  const currRange = h2 - l2;
  const currBody = Math.abs(c2 - o2);
  const upperWick = h2 - Math.max(o2, c2);
  const lowerWick = Math.min(o2, c2) - l2;

  const isDoji = currRange > 0 && currBody / currRange <= 0.12;
  if (isDoji) {
    patterns.push({ name: 'DOJI', bias: 'NEUTRAL', strength: 10 });
  }

  const bullishEngulfing =
    prevBear && currBull && currBodyMin <= prevBodyMin && currBodyMax >= prevBodyMax;
  if (bullishEngulfing) {
    patterns.push({ name: 'BULLISH_ENGULFING', bias: 'BUY', strength: 22 });
  }

  const bearishEngulfing =
    prevBull && currBear && currBodyMin <= prevBodyMin && currBodyMax >= prevBodyMax;
  if (bearishEngulfing) {
    patterns.push({ name: 'BEARISH_ENGULFING', bias: 'SELL', strength: 22 });
  }

  const pinbarBull = currRange > 0 && lowerWick >= currBody * 2.2 && upperWick <= currBody * 0.8;
  if (pinbarBull) {
    patterns.push({ name: 'PINBAR_BULL', bias: 'BUY', strength: 14 });
  }

  const pinbarBear = currRange > 0 && upperWick >= currBody * 2.2 && lowerWick <= currBody * 0.8;
  if (pinbarBear) {
    patterns.push({ name: 'PINBAR_BEAR', bias: 'SELL', strength: 14 });
  }

  return patterns;
};

export function analyzeCandleSeries(series, { timeframe = null } = {}) {
  const raw = Array.isArray(series) ? series : [];
  const normalized = raw
    .map((c) => {
      const timeMs = normalizeTimeMs(c?.time ?? c?.timestamp ?? c?.t);
      const open = safeNumber(c?.open);
      const high = safeNumber(c?.high);
      const low = safeNumber(c?.low);
      const close = safeNumber(c?.close);
      if (timeMs == null || open == null || high == null || low == null || close == null) {
        return null;
      }
      return { timeMs, open, high, low, close, volume: safeNumber(c?.volume) };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (normalized.length < 3) {
    return null;
  }

  const closes = normalized.map((c) => c.close);
  const newest = normalized[normalized.length - 1];
  const oldestIndex = Math.max(0, normalized.length - 1 - Math.min(20, normalized.length - 2));
  const oldest = normalized[oldestIndex];

  const trendPct =
    oldest?.close && oldest.close !== 0 ? ((newest.close - oldest.close) / oldest.close) * 100 : 0;

  const returns = [];
  for (let i = Math.max(1, normalized.length - 30); i < normalized.length; i += 1) {
    const prev = normalized[i - 1];
    const curr = normalized[i];
    if (!prev?.close || prev.close === 0) {
      continue;
    }
    returns.push((curr.close - prev.close) / prev.close);
  }

  const volatility = computeStdDev(returns);
  const atr = computeAtr(normalized, 14);
  const atrPct = atr != null && newest?.close ? (atr / newest.close) * 100 : null;

  const rsi = computeRsi(closes, 14);
  const regression = computeRegression(closes, 30);
  const r2 = regression?.r2 ?? null;

  const structure = detectStructure(normalized, 8);
  const patterns = detectPatterns(normalized);

   const smcLiquiditySweep = detectLiquiditySweep(normalized, { lookback: 20, atr });
   const smcOrderBlock = detectOrderBlock(normalized, { atr, lookback: 40, impulseLookback: 12 });
   const smcVolumeSpike = detectVolumeSpike(normalized, 20);
   const smcImbalance = computeVolumeImbalance(normalized, 20);
   const smcPriceImbalance = detectPriceImbalance(normalized, { lookback: 34, atr });
   const liquidityTrap = (() => {
     if (!smcLiquiditySweep || !smcLiquiditySweep.bias || !smcLiquiditySweep.confidence) {
       return null;
     }
     const trapFollowThroughMax = envNumber('SMC_TRAP_FOLLOW_THROUGH_MAX_PCT', 0.12);
     const trapConfidenceMin = envNumber('SMC_TRAP_CONFIDENCE_MIN', 62);
     const trapVolumeRatioMax = envNumber('SMC_TRAP_VOLUME_RATIO_MAX', 1.1);

     const last = normalized[normalized.length - 1];
     const prev = normalized[normalized.length - 2];
     if (!last || !prev) {
       return null;
     }
     const movePct =
       prev.close && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
     const followThroughWeak =
       movePct != null && Math.abs(movePct) <= trapFollowThroughMax;

     const volumeRatio =
       smcVolumeSpike && smcVolumeSpike.average && smcVolumeSpike.average > 0
         ? smcVolumeSpike.newest / smcVolumeSpike.average
         : null;
     const volumeWeak = volumeRatio != null ? volumeRatio <= trapVolumeRatioMax : false;

     const trapScore = clamp(
       Math.round(
         (smcLiquiditySweep.confidence * 0.6 +
           (followThroughWeak ? 25 : 0) +
           (volumeWeak ? 15 : 0))
       ),
       0,
       100
     );

     if (trapScore < trapConfidenceMin) {
       return null;
     }

     return {
       bias: smcLiquiditySweep.bias === 'BUY' ? 'SELL' : 'BUY',
       type: smcLiquiditySweep.type,
       confidence: trapScore,
       followThroughPct: movePct != null ? Number(movePct.toFixed(4)) : null,
       volumeRatio: volumeRatio != null ? Number(volumeRatio.toFixed(2)) : null
     };
   })();

  const smcAccumDist = (() => {
    const spike = smcVolumeSpike;
    const imb = smcImbalance;
    if (!spike || !spike.isSpike || !imb) {
      return null;
    }
    // High volume but muted move suggests absorption / accumulation/distribution.
    const slice = normalized.slice(Math.max(0, normalized.length - 10));
    const first = slice[0];
    const last = slice[slice.length - 1];
    const pctMove =
      first?.close && first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : null;
    if (pctMove == null) {
      return null;
    }
    const muted = Math.abs(pctMove) <= 0.12;
    if (!muted) {
      return { state: 'neutral', confidence: 35, pctMove: Number(pctMove.toFixed(3)) };
    }
    if (imb.state === 'buying') {
      return {
        state: 'accumulation',
        confidence: 70,
        pctMove: Number(pctMove.toFixed(3)),
        pressurePct: imb.pressurePct
      };
    }
    if (imb.state === 'selling') {
      return {
        state: 'distribution',
        confidence: 70,
        pctMove: Number(pctMove.toFixed(3)),
        pressurePct: imb.pressurePct
      };
    }
    return { state: 'neutral', confidence: 45, pctMove: Number(pctMove.toFixed(3)) };
  })();

  const volumes = normalized.map((c) => safeNumber(c?.volume)).filter((v) => v != null);
  let volumeSummary = null;
  if (volumes.length >= 6) {
    const newestVol = volumes[volumes.length - 1];
    const slice = volumes.slice(Math.max(0, volumes.length - 20));
    const avg = slice.reduce((sum, v) => sum + v, 0) / Math.max(1, slice.length);
    const oldestVol = volumes[Math.max(0, volumes.length - 1 - Math.min(20, volumes.length - 2))];
    const trendPct = oldestVol && oldestVol !== 0 ? ((newestVol - oldestVol) / oldestVol) * 100 : 0;
    volumeSummary = {
      newest: newestVol != null ? Number(newestVol.toFixed(2)) : null,
      average: Number(avg.toFixed(2)),
      trendPct: Number(trendPct.toFixed(2))
    };
  }

  const trendDirection = trendPct > 0.03 ? 'BUY' : trendPct < -0.03 ? 'SELL' : 'NEUTRAL';

  const regimeState = r2 != null && r2 >= 0.62 && Math.abs(trendPct) >= 0.18 ? 'trend' : 'range';
  const regimeConfidence = r2 != null ? clamp(r2 * 100, 0, 100) : 0;

  const volState =
    atrPct == null ? 'unknown' : atrPct >= 0.75 ? 'high' : atrPct <= 0.22 ? 'low' : 'normal';

  const patternScore = patterns.reduce((sum, p) => {
    const dir = String(p?.bias || '').toUpperCase();
    const strength = safeNumber(p?.strength) ?? 0;
    if (dir === 'BUY') {
      return sum + strength;
    }
    if (dir === 'SELL') {
      return sum - strength;
    }
    return sum;
  }, 0);

  const structureScore =
    structure?.bias === 'BUY'
      ? clamp((structure.score || 0) * 6, 0, 18)
      : structure?.bias === 'SELL'
        ? -clamp((Math.abs(structure.score) || 0) * 6, 0, 18)
        : 0;

  const rsiScore = rsi == null ? 0 : rsi <= 28 ? 10 : rsi >= 72 ? -10 : 0;

  const trendScore = clamp(trendPct * 8, -60, 60);
  const r2Score = r2 == null ? 0 : clamp((r2 - 0.4) * 70, -18, 22);

  const volatilityPenalty = volatility == null ? 0 : clamp(volatility * 10000 * 0.05, 0, 14);

  const rawScore = clamp(
    trendScore + r2Score + rsiScore + structureScore + patternScore - volatilityPenalty,
    -100,
    100
  );

  const direction = rawScore > 10 ? 'BUY' : rawScore < -10 ? 'SELL' : 'NEUTRAL';
  const strength = clamp(Math.abs(rawScore) * 1.1, 0, 100);

  const confidenceBase =
    clamp((normalized.length / 40) * 55, 0, 55) + clamp(regimeConfidence * 0.45, 0, 45);
  const confidence = clamp(confidenceBase - (volatilityPenalty || 0), 0, 100);

  const scoreDelta =
    direction === 'BUY'
      ? clamp(strength * 0.18, 0, 18)
      : direction === 'SELL'
        ? -clamp(strength * 0.18, 0, 18)
        : 0;

  return {
    timeframe: timeframe || null,
    inspectedAt: Date.now(),
    sampleCount: normalized.length,
    newestTimeMs: newest.timeMs,
    newestClose: newest.close,
    direction,
    strength: Number(strength.toFixed(1)),
    confidence: Number(confidence.toFixed(0)),
    rawScore: Number(rawScore.toFixed(2)),
    scoreDelta: Number(scoreDelta.toFixed(2)),
    trendPct: Number(trendPct.toFixed(4)),
    regime: {
      state: regimeState,
      confidence: Number(regimeConfidence.toFixed(0)),
      r2: r2 != null ? Number((r2 * 100).toFixed(0)) : null,
      slope: regression?.slope != null ? Number(regression.slope.toFixed(8)) : null
    },
    volatility: {
      state: volState,
      atr: atr != null ? Number(atr.toFixed(8)) : null,
      atrPct: atrPct != null ? Number(atrPct.toFixed(4)) : null,
      stdevReturns: volatility != null ? Number(volatility.toFixed(8)) : null
    },
    structure: structure
      ? {
          state: structure.state,
          bias: structure.bias,
          confidence: structure.confidence
        }
      : null,
    patterns: patterns.slice(0, 4),
    volume: volumeSummary,
     smc: {
      liquiditySweep: smcLiquiditySweep,
      liquidityTrap,
      orderBlock: smcOrderBlock,
      volumeSpike: smcVolumeSpike,
      volumeImbalance: smcImbalance,
      accumulationDistribution: smcAccumDist,
      priceImbalance: smcPriceImbalance
    },
    notes: {
      trendDirection,
      source: 'ohlc'
    }
  };
}

export function aggregateCandleAnalyses(byTimeframe) {
  const map = byTimeframe && typeof byTimeframe === 'object' ? byTimeframe : {};
  const entries = Object.entries(map).filter(([, value]) => value && typeof value === 'object');
  if (!entries.length) {
    return null;
  }

  const weights = { D1: 1.0, H4: 0.85, H1: 0.7, M15: 0.55, M1: 0.35 };
  let weightedDelta = 0;
  let weightSum = 0;
  let buyVotes = 0;
  let sellVotes = 0;
  let neutralVotes = 0;
  let confidenceSum = 0;

  for (const [tf, analysis] of entries) {
    const w = Number.isFinite(Number(weights[tf])) ? Number(weights[tf]) : 0.5;
    const delta = safeNumber(analysis?.scoreDelta) ?? 0;
    weightedDelta += delta * w;
    weightSum += w;

    const dir = String(analysis?.direction || 'NEUTRAL').toUpperCase();
    if (dir === 'BUY') {
      buyVotes += 1;
    } else if (dir === 'SELL') {
      sellVotes += 1;
    } else {
      neutralVotes += 1;
    }

    confidenceSum += (safeNumber(analysis?.confidence) ?? 0) * w;
  }

  const avgDelta = weightSum ? weightedDelta / weightSum : 0;
  const avgConfidence = weightSum ? confidenceSum / weightSum : 0;

  const direction = buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'NEUTRAL';
  const strength = clamp(Math.abs(avgDelta) * 5.5, 0, 100);

  return {
    direction,
    strength: Number(strength.toFixed(1)),
    confidence: Number(clamp(avgConfidence, 0, 100).toFixed(0)),
    scoreDelta: Number(clamp(avgDelta, -18, 18).toFixed(2)),
    directionSummary: { BUY: buyVotes, SELL: sellVotes, NEUTRAL: neutralVotes }
  };
}
