import VectorizedBacktester from './vectorized-backtester.js';

const DEFAULTS = {
  timeframe: 'M15',
  lookbackDays: 30,
  maxBars: 3200,
  minTrades: 20,
  minWinRate: 0.62,
  minProfitFactor: 1.1,
  maxDrawdownPct: 18,
  minExpectancyPct: 0.2,
  holdBars: 12,
  signalStride: 4,
  defaultTakeProfitPips: 40,
  defaultStopLossPips: 22
};

const resolveNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const resolveTimeframeMinutes = (tf) => {
  const normalized = String(tf || '').trim().toUpperCase();
  const map = {
    M1: 1,
    M2: 2,
    M3: 3,
    M5: 5,
    M10: 10,
    M15: 15,
    M30: 30,
    H1: 60,
    H2: 120,
    H3: 180,
    H4: 240,
    H6: 360,
    H8: 480,
    H12: 720,
    D1: 1440
  };
  return map[normalized] || 15;
};

export class LiveBacktestValidator {
  constructor({ priceDataFetcher, backtester, logger, options = {} } = {}) {
    this.priceDataFetcher = priceDataFetcher || null;
    this.backtester = backtester || new VectorizedBacktester();
    this.logger = logger || null;
    this.options = {
      ...DEFAULTS,
      ...(options || {})
    };
  }

  resolveOptions() {
    const env = (key) => process.env[key];
    const numberEnv = (key) => resolveNumber(env(key));

    return {
      timeframe: String(env('LIVE_BACKTEST_TIMEFRAME') || this.options.timeframe).toUpperCase(),
      lookbackDays: numberEnv('LIVE_BACKTEST_LOOKBACK_DAYS') ?? this.options.lookbackDays,
      maxBars: numberEnv('LIVE_BACKTEST_MAX_BARS') ?? this.options.maxBars,
      minTrades: numberEnv('LIVE_BACKTEST_MIN_TRADES') ?? this.options.minTrades,
      minWinRate: numberEnv('LIVE_BACKTEST_MIN_WIN_RATE') ?? this.options.minWinRate,
      minProfitFactor: numberEnv('LIVE_BACKTEST_MIN_PROFIT_FACTOR') ?? this.options.minProfitFactor,
      maxDrawdownPct: numberEnv('LIVE_BACKTEST_MAX_DRAWDOWN_PCT') ?? this.options.maxDrawdownPct,
      minExpectancyPct: numberEnv('LIVE_BACKTEST_MIN_EXPECTANCY_PCT') ?? this.options.minExpectancyPct,
      holdBars: numberEnv('LIVE_BACKTEST_HOLD_BARS') ?? this.options.holdBars,
      signalStride: numberEnv('LIVE_BACKTEST_SIGNAL_STRIDE') ?? this.options.signalStride,
      defaultTakeProfitPips:
        numberEnv('LIVE_BACKTEST_TAKE_PROFIT_PIPS') ?? this.options.defaultTakeProfitPips,
      defaultStopLossPips:
        numberEnv('LIVE_BACKTEST_STOP_LOSS_PIPS') ?? this.options.defaultStopLossPips
    };
  }

  buildSyntheticSignals(bars, direction, entry, options) {
    if (!Array.isArray(bars) || bars.length === 0) {
      return [];
    }

    const takeProfitPips =
      resolveNumber(entry?.takeProfitPips) ?? options.defaultTakeProfitPips;
    const stopLossPips = resolveNumber(entry?.stopLossPips) ?? options.defaultStopLossPips;

    const stride = Math.max(1, Math.floor(options.signalStride));
    const signals = [];
    for (let i = 0; i < bars.length; i += stride) {
      const bar = bars[i];
      const timestamp = bar?.timestamp ?? bar?.time ?? bar?.datetime ?? bar?.date ?? null;
      if (!timestamp) {
        continue;
      }
      signals.push({
        direction,
        timestamp,
        takeProfitPips,
        stopLossPips,
        holdBars: options.holdBars
      });
    }

    return signals;
  }

  async validateSignal(signal, pair) {
    if (!this.priceDataFetcher || typeof this.priceDataFetcher.fetchPriceData !== 'function') {
      return { passed: true, skipped: true, reason: 'no_price_data_fetcher' };
    }

    const directionRaw = String(signal?.direction || '').toUpperCase();
    const direction = directionRaw === 'BUY' ? 'LONG' : directionRaw === 'SELL' ? 'SHORT' : null;
    if (!direction) {
      return { passed: true, skipped: true, reason: 'non_directional' };
    }

    const options = this.resolveOptions();
    const tfMinutes = resolveTimeframeMinutes(options.timeframe);
    const targetBars = Math.min(
      options.maxBars,
      Math.max(200, Math.round((options.lookbackDays * 1440) / tfMinutes))
    );

    let bars = [];
    try {
      bars = await this.priceDataFetcher.fetchPriceData(pair, options.timeframe, targetBars, {
        purpose: 'live-backtest'
      });
    } catch (error) {
      this.logger?.warn?.(
        { module: 'LiveBacktestValidator', pair, err: error },
        'Live backtest price fetch failed'
      );
      return { passed: true, skipped: true, reason: 'fetch_failed' };
    }

    if (!Array.isArray(bars) || bars.length < 50) {
      return { passed: true, skipped: true, reason: 'insufficient_bars' };
    }

    const signals = this.buildSyntheticSignals(bars, direction, signal?.entry, options);
    if (signals.length < Math.max(5, options.minTrades)) {
      return { passed: true, skipped: true, reason: 'insufficient_signals' };
    }

    const runResult = this.backtester.run({
      pair,
      timeframe: options.timeframe,
      bars,
      signals
    });

    const metrics = runResult.metrics || {};
    const reasons = [];

    if ((metrics.totalTrades || 0) < options.minTrades) {
      reasons.push('min_trades');
    }

    if ((metrics.winRate || 0) < options.minWinRate) {
      reasons.push('min_win_rate');
    }

    if ((metrics.profitFactor || 0) < options.minProfitFactor) {
      reasons.push('min_profit_factor');
    }

    if ((metrics.maxDrawdownPct || 0) > options.maxDrawdownPct) {
      reasons.push('max_drawdown');
    }

    if ((metrics.expectancyPct || 0) < options.minExpectancyPct) {
      reasons.push('min_expectancy');
    }

    const passed = reasons.length === 0;

    const windowStart = bars[0]?.timestamp ?? bars[0]?.time ?? bars[0]?.datetime ?? null;
    const windowEnd =
      bars[bars.length - 1]?.timestamp ?? bars[bars.length - 1]?.time ?? bars[bars.length - 1]?.datetime ?? null;

    return {
      passed,
      reasons,
      metrics,
      window: {
        timeframe: options.timeframe,
        lookbackDays: options.lookbackDays,
        bars: bars.length,
        start: windowStart,
        end: windowEnd
      },
      thresholds: {
        minTrades: options.minTrades,
        minWinRate: options.minWinRate,
        minProfitFactor: options.minProfitFactor,
        maxDrawdownPct: options.maxDrawdownPct,
        minExpectancyPct: options.minExpectancyPct
      }
    };
  }
}

export default LiveBacktestValidator;
