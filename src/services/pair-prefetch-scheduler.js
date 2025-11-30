import { recordPrefetchResult, setPrefetchQueueDepth } from './metrics.js';

const DEFAULT_OPTIONS = {
  tickIntervalMs: 60000,
  maxPairsPerTick: 2,
  maxPairsWhenPressure: 1,
  minPairsWhenPressure: 1,
  quotaPressureThreshold: 0.85,
  defaultTimeframes: ['M15', 'H1', 'H4'],
  barsPerTimeframe: {
    M5: 200,
    M15: 240,
    H1: 260,
    H4: 320,
    D1: 400
  },
  cadenceMinutes: {
    M5: 6,
    M15: 12,
    H1: 45,
    H4: 180,
    D1: 480
  },
  volatilityTiers: {
    high: 0.6,
    medium: 1,
    low: 1.4
  }
};

const MINUTE_IN_MS = 60000;

export default class PairPrefetchScheduler {
  constructor({ priceDataFetcher, catalog, logger, options = {} }) {
    if (!priceDataFetcher) {
      throw new Error('PairPrefetchScheduler requires a priceDataFetcher instance');
    }

    this.priceDataFetcher = priceDataFetcher;
    this.catalog = Array.isArray(catalog) ? catalog : [];
    this.logger = logger || console;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      barsPerTimeframe: {
        ...DEFAULT_OPTIONS.barsPerTimeframe,
        ...(options.barsPerTimeframe || {})
      },
      cadenceMinutes: { ...DEFAULT_OPTIONS.cadenceMinutes, ...(options.cadenceMinutes || {}) },
      volatilityTiers: { ...DEFAULT_OPTIONS.volatilityTiers, ...(options.volatilityTiers || {}) }
    };

    this.timer = null;
    this.isRunning = false;
    this.lastPrefetch = new Map(); // key: pair|tf -> timestamp
  }

  start() {
    if (this.isRunning) {
      return;
    }

    if (this.catalog.length === 0) {
      this.logger.warn('Pair prefetch scheduler has no catalog entries; start skipped');
      return;
    }

    this.isRunning = true;
    const tick = async () => {
      try {
        await this.runCycle();
      } catch (error) {
        this.logger.error({ err: error }, 'Prefetch scheduler cycle failed');
      }
    };

    this.timer = setInterval(tick, this.options.tickIntervalMs);
    void tick();
    this.logger.info({ tickMs: this.options.tickIntervalMs }, 'Prefetch scheduler started');
  }

  stop() {
    if (!this.isRunning) {
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    setPrefetchQueueDepth(0);
    this.logger.info('Prefetch scheduler stopped');
  }

  async runCycle(nowInput = Date.now()) {
    const now = typeof nowInput === 'number' ? nowInput : nowInput.getTime();
    const minuteOfDay = this.extractMinuteOfDay(now);

    const tasks = this.buildCandidateTasks(now, minuteOfDay);
    if (tasks.length === 0) {
      setPrefetchQueueDepth(0);
      return;
    }

    tasks.sort((a, b) => b.priority - a.priority);
    setPrefetchQueueDepth(tasks.length);

    const providersUnderPressure = this.getProvidersUnderPressure();
    const maxWhenPressure = Number.isFinite(this.options.maxPairsWhenPressure)
      ? Math.max(1, this.options.maxPairsWhenPressure)
      : Math.max(1, Math.floor(this.options.maxPairsPerTick / 2));
    const maxPairs =
      providersUnderPressure.size > 0 ? Math.max(1, maxWhenPressure) : this.options.maxPairsPerTick;
    const minWhenPressure = Math.max(
      1,
      Number.isFinite(this.options.minPairsWhenPressure) ? this.options.minPairsWhenPressure : 1
    );

    const selected = [];

    for (const task of tasks) {
      if (selected.length >= maxPairs) {
        break;
      }

      const providerOrder = this.priceDataFetcher?.getProviderOrder?.(task.timeframe) || [];
      const primaryProvider = providerOrder.find((provider) =>
        this.priceDataFetcher?.providerConfigured?.(provider)
      );
      const underPressure = primaryProvider ? providersUnderPressure.has(primaryProvider) : false;

      if (underPressure && selected.length >= minWhenPressure) {
        this.logger?.debug?.(
          {
            pair: task.pair,
            timeframe: task.timeframe,
            provider: primaryProvider
          },
          'Prefetch skipped due to provider quota pressure'
        );
        continue;
      }

      selected.push(task);
    }

    if (selected.length === 0 && tasks.length > 0) {
      selected.push(tasks[0]);
    }

    for (const task of selected) {
      await this.executeTask(task, now);
    }
  }

  buildCandidateTasks(now, minuteOfDay) {
    const tasks = [];

    for (const entry of this.catalog) {
      const timeframes =
        entry.timeframes && entry.timeframes.length > 0
          ? entry.timeframes
          : this.options.defaultTimeframes;

      const sessionWeight = this.resolveSessionWeight(entry.sessions || [], minuteOfDay);
      const volatilityFactor = this.options.volatilityTiers[entry.volatilityTier || 'medium'] ?? 1;

      for (const timeframe of timeframes) {
        const cadenceMinutes =
          this.options.cadenceMinutes[timeframe] || this.options.cadenceMinutes.M15;
        const cadenceMs = cadenceMinutes * MINUTE_IN_MS;
        const key = `${entry.pair}|${timeframe}`;
        const lastRun = this.lastPrefetch.get(key) || 0;
        const elapsed = now - lastRun;
        if (elapsed < cadenceMs) {
          continue;
        }

        const stalenessFactor = Math.min(2.5, elapsed / cadenceMs);
        const freshnessBoost = lastRun === 0 ? 1.25 : 1;
        const priority = (stalenessFactor / volatilityFactor) * sessionWeight * freshnessBoost;

        tasks.push({
          pair: entry.pair,
          timeframe,
          bars: this.options.barsPerTimeframe[timeframe] || 240,
          priority,
          key,
          metadata: entry
        });
      }
    }

    return tasks;
  }

  async executeTask(task, now) {
    try {
      await this.priceDataFetcher.fetchPriceData(task.pair, task.timeframe, task.bars, {
        bypassCache: true,
        purpose: 'refresh'
      });
      this.lastPrefetch.set(task.key, now);
      recordPrefetchResult(task.pair, task.timeframe, 'success');
      this.logger.debug({ pair: task.pair, timeframe: task.timeframe }, 'Prefetch completed');
    } catch (error) {
      recordPrefetchResult(task.pair, task.timeframe, 'error');
      this.logger.error(
        { err: error, pair: task.pair, timeframe: task.timeframe },
        'Prefetch failed'
      );
    }
  }

  getProvidersUnderPressure() {
    const fetcher = this.priceDataFetcher;
    if (!fetcher || typeof fetcher.isQuotaPressure !== 'function') {
      return new Set();
    }

    const threshold = Number.isFinite(this.options.quotaPressureThreshold)
      ? this.options.quotaPressureThreshold
      : DEFAULT_OPTIONS.quotaPressureThreshold;

    const providers = ['twelveData', 'alphaVantage', 'polygon', 'finnhub'];
    const result = new Set();

    providers.forEach((provider) => {
      if (
        typeof fetcher.providerConfigured === 'function' &&
        !fetcher.providerConfigured(provider)
      ) {
        return;
      }
      try {
        if (fetcher.isQuotaPressure(provider, threshold)) {
          result.add(provider);
        }
      } catch (error) {
        this.logger?.debug?.(
          { provider, err: error?.message },
          'Failed to evaluate quota pressure'
        );
      }
    });

    return result;
  }

  resolveSessionWeight(sessions, minuteOfDay) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return 1;
    }

    let weight = 1;
    for (const session of sessions) {
      const start = this.parseMinutes(session.start);
      const end = this.parseMinutes(session.end);
      const isActive = this.isWithinWindow(start, end, minuteOfDay);
      const baseWeight = Number.isFinite(session.weight) ? session.weight : 1.2;
      if (isActive) {
        weight = Math.max(weight, baseWeight);
      } else {
        const distance = this.minutesUntilWindow(start, minuteOfDay);
        if (distance <= 90) {
          const ramp = 1 + (90 - distance) / 180;
          weight = Math.max(weight, Math.min(baseWeight, ramp));
        }
      }
    }
    return weight;
  }

  extractMinuteOfDay(timestamp) {
    const date = new Date(timestamp);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  parseMinutes(timeString) {
    if (typeof timeString !== 'string') {
      return 0;
    }
    const [hours, minutes] = timeString.split(':').map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return 0;
    }
    return (hours * 60 + minutes) % (24 * 60);
  }

  isWithinWindow(start, end, minuteOfDay) {
    if (start === end) {
      return false;
    }
    if (start < end) {
      return minuteOfDay >= start && minuteOfDay < end;
    }
    return minuteOfDay >= start || minuteOfDay < end;
  }

  minutesUntilWindow(start, minuteOfDay) {
    if (start >= minuteOfDay) {
      return start - minuteOfDay;
    }
    return 24 * 60 - minuteOfDay + start;
  }
}
