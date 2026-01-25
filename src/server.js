/**
 * Intelligent Auto-Trading Server
 * REST API for automated trading system with real-time monitoring
 */

import TradingEngine from './engine/trading-engine.js';
import TradeManager from './engine/trade-manager.js';
import HeartbeatMonitor from './services/heartbeat-monitor.js';
import { enforceRealTimeProviderReadiness } from './utils/realtime-provider-check.js';
import logger from './services/logging/logger.js';
import AlertBus from './services/alerting/alert-bus.js';
import RiskReportService from './services/alerting/risk-report-service.js';
import PerformanceDigestService from './services/alerting/performance-digest-service.js';
import BrokerRouter from './services/brokers/broker-router.js';
import BrokerReconciliationService from './services/brokers/reconciliation-service.js';
import EaBridgeService from './services/brokers/ea-bridge-service.js';
import SecretManager from './services/security/secret-manager.js';
import AuditLogger from './services/logging/audit-logger.js';
import { metrics as metricsRegistry } from './services/metrics.js';
import PairPrefetchScheduler from './services/pair-prefetch-scheduler.js';
import JobQueue from './services/jobs/job-queue.js';
import { pairCatalog } from './config/pair-catalog.js';
import { appConfig } from './app/config.js';
import { startServer } from './app/startup.js';
import { buildProviderAvailabilitySnapshot } from './services/health-summary.js';
import { startRssToEaBridgeIngestor } from './services/bridge/rss-to-ea-bridge.js';
import EconomicCalendarService from './services/economic-calendar-service.js';
import { createMarketRules } from './engine/market-rules.js';
import { eaOnlyMode } from './config/runtime-flags.js';

// Default to EA-only in the real server unless explicitly overridden.
// Tests that construct the app directly won't hit this file.
if (process.env.EA_ONLY_MODE == null || String(process.env.EA_ONLY_MODE).trim() === '') {
  const nodeEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (nodeEnv !== 'test') {
    process.env.EA_ONLY_MODE = 'true';
  }
}

let shutdownHook = null;
let fatalErrorSeen = false;

const coerceError = (value) => {
  if (value instanceof Error) {
    return value;
  }
  try {
    return new Error(typeof value === 'string' ? value : JSON.stringify(value));
  } catch (_error) {
    return new Error(String(value));
  }
};

process.on('unhandledRejection', (reason) => {
  const err = coerceError(reason);
  // Ensure we always see the error even if async logger fails/flushed late.
  console.error('[unhandledRejection]', err);
  logger.error({ err }, 'Unhandled promise rejection');
  if (shutdownHook && !fatalErrorSeen) {
    fatalErrorSeen = true;
    shutdownHook('unhandledRejection', err);
  }
});

process.on('uncaughtException', (error) => {
  const err = coerceError(error);
  // Ensure we always see the error even if async logger fails/flushed late.
  console.error('[uncaughtException]', err);
  logger.error({ err }, 'Uncaught exception');
  if (shutdownHook && !fatalErrorSeen) {
    fatalErrorSeen = true;
    shutdownHook('uncaughtException', err);
  }
});

// Load configuration
const serverConfig = appConfig.server;
const tradingConfig = appConfig.trading;
const brokerConfig = appConfig.brokers;
const brokerRoutingConfig = appConfig.brokerRouting;
const serviceToggles = appConfig.services;
const pairPrefetchSettings = appConfig.pairPrefetch;
const autoTradingConfig = appConfig.autoTrading;
const databaseConfig = appConfig.database;
const rawEnv = appConfig.env;
const alertingConfig = appConfig.alerting;

// Provider availability state
const providerAvailabilityHistoryLimit = Number.isFinite(
  serverConfig.providerAvailabilityHistoryLimit
)
  ? Math.max(1, serverConfig.providerAvailabilityHistoryLimit)
  : 288;
const providerAvailabilityAlertConfig = serverConfig.providerAvailabilityAlert || {};
const providerAvailabilityHistory = [];

// Initialize core services
const secretManager = new SecretManager({ logger, env: rawEnv });
const auditLogger = new AuditLogger({ logger, env: rawEnv });

void auditLogger.init().catch((error) => {
  logger.error({ err: error }, 'Failed to initialize audit logger');
});

const jobQueueConfig = appConfig.services?.jobQueue || {};
const jobQueue =
  jobQueueConfig.enabled !== false
    ? new JobQueue({
        logger,
        auditLogger,
        concurrency: jobQueueConfig.concurrency,
        retryAttempts: jobQueueConfig.retryAttempts,
        retryBaseMs: jobQueueConfig.retryBaseMs,
        retryMaxMs: jobQueueConfig.retryMaxMs,
        maxQueueSize: jobQueueConfig.maxQueueSize,
        deadLetterMax: jobQueueConfig.deadLetterMax
      })
    : null;

if (jobQueue) {
  jobQueue.start();
}

// Initialize alert bus
const alertBus = new AlertBus({
  slackWebhookUrl: alertingConfig.slackWebhookUrl,
  webhookUrls: alertingConfig.webhookUrls,
  email: alertingConfig.email,
  dedupeMs: alertingConfig.dedupeMs,
  logger
});

// Initialize broker router
const brokerRouter = new BrokerRouter({
  logger,
  auditLogger,
  defaultBroker: brokerRoutingConfig.defaultBroker || 'mt5',
  idempotencyTtlMs: brokerRoutingConfig.idempotencyTtlMs,
  retryAttempts: brokerRoutingConfig.retryAttempts,
  retryBaseMs: brokerRoutingConfig.retryBaseMs,
  breakerThreshold: brokerRoutingConfig.breakerThreshold,
  breakerCooldownMs: brokerRoutingConfig.breakerCooldownMs,
  marketRules: createMarketRules(appConfig.trading?.marketRules || {}),
  oanda: brokerConfig.oanda?.enabled
    ? {
        accountMode: brokerConfig.oanda.accountMode || 'demo',
        accessToken: brokerConfig.oanda.accessToken,
        accountId: brokerConfig.oanda.accountId
      }
    : false,
  mt4: brokerConfig.mt4?.enabled
    ? {
        accountMode: brokerConfig.mt4.accountMode || 'demo',
        baseUrl: brokerConfig.mt4.baseUrl,
        apiKey: brokerConfig.mt4.apiKey,
        accountNumber: brokerConfig.mt4.accountNumber
      }
    : false,
  mt5: brokerConfig.mt5?.enabled
    ? {
        accountMode: brokerConfig.mt5.accountMode || 'demo',
        baseUrl: brokerConfig.mt5.baseUrl,
        apiKey: brokerConfig.mt5.apiKey,
        accountNumber: brokerConfig.mt5.accountNumber
      }
    : false,
  ibkr: brokerConfig.ibkr?.enabled
    ? {
        accountMode: brokerConfig.ibkr.accountMode || 'demo',
        baseUrl: brokerConfig.ibkr.baseUrl,
        accountId: brokerConfig.ibkr.accountId,
        allowSelfSigned: brokerConfig.ibkr.allowSelfSigned
      }
    : false
});

// Build trading engine config
const config = { ...tradingConfig };
config.brokerRouting = { ...brokerRoutingConfig };
config.auditLogger = auditLogger;
config.jobQueue = jobQueue;
config.dependencies = {
  ...(config.dependencies || {}),
  alertBus,
  brokerRouter: config.brokerRouting?.enabled ? brokerRouter : null
};

// Enforce real-time provider readiness
try {
  enforceRealTimeProviderReadiness(config.apiKeys, rawEnv);
  logger.info('Real-time data enforcement active (synthetic fallbacks disabled).');
} catch (error) {
  console.error('Real-time data configuration error:', error?.message || error);
  logger.error({ err: error }, 'Real-time data configuration error');
  if (error.code === 'REALTIME_DATA_REQUIRED') {
    logger.error(
      'Set ALLOW_SYNTHETIC_DATA=true temporarily if you need to bypass live data checks during development.'
    );

    if (serverConfig.nodeEnv !== 'production' && serverConfig.nodeEnv !== 'test') {
      process.env.ALLOW_SYNTHETIC_DATA = 'true';
      process.env.REQUIRE_REALTIME_DATA = 'false';
      logger.warn('Continuing startup with synthetic data enabled (local/dev mode fallback).');
    } else {
      process.exit(1);
    }
  } else {
    console.error('Fatal startup error:', error?.message || error);
    process.exit(1);
  }
}

// Log provider credentials status
const isEaOnlyMode = eaOnlyMode(rawEnv);
if (!isEaOnlyMode) {
  logger.info(
    {
      providers: {
        twelveData: Boolean(config.apiKeys.twelveData),
        alphaVantage: Boolean(config.apiKeys.alphaVantage),
        finnhub: Boolean(config.apiKeys.finnhub),
        polygon: Boolean(config.apiKeys.polygon),
        newsApi: Boolean(config.apiKeys.newsApi)
      }
    },
    'Provider credentials configuration status'
  );

  const missingPriceProviders = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'].filter(
    (key) => !config.apiKeys[key]
  );
  if (missingPriceProviders.length > 0) {
    logger.warn(
      { providers: missingPriceProviders },
      'Real-time price data providers missing credentials'
    );
    logger.warn('Price fetcher will fall back to cached/simulated data if live calls fail.');
  }

  if (!config.apiKeys.fred) {
    logger.warn(
      'FRED credentials are not configured. Retail sales and manufacturing metrics will be unavailable.'
    );
  }
}

if (!databaseConfig.host || !databaseConfig.user || !databaseConfig.password) {
  logger.warn(
    'TimescaleDB connection is not configured. Persistence will run in in-memory mode only.'
  );
}

// Initialize trading engine
const tradingEngine = new TradingEngine(config);
if (config.brokerRouting?.enabled) {
  tradingEngine.setBrokerRouter(brokerRouter);
}
const tradeManager = new TradeManager(tradingEngine);
const heartbeatMonitor = new HeartbeatMonitor({ tradingEngine, tradeManager });

// Initialize EA Bridge Service for MT4/MT5 Expert Advisor communication
const eaBridgeService = new EaBridgeService({
  tradingEngine,
  brokerRouter,
  logger,
  brokerMeta: appConfig.brokerMeta
});
logger.info('EA Bridge Service initialized for intelligent MT4/MT5 integration');

// External economic calendar (ForexFactory export) used as a fallback in EA-only mode
// until MT4/MT5 pushes structured calendar events through the bridge.
const economicCalendarService = new EconomicCalendarService({
  finnhub: process.env.FINNHUB_API_KEY
});

// Optional: feed the EA-only news pipeline from the built-in RSS aggregator.
// This keeps headlines/events flowing even when the EA hasn't implemented news ingestion yet.
try {
  const rssStatus = startRssToEaBridgeIngestor({
    eaBridgeService,
    brokers: ['mt5', 'mt4'],
    logger,
    calendarService: economicCalendarService
  });
  if (rssStatus?.started) {
    logger.info(
      { intervalMs: rssStatus.intervalMs, maxItems: rssStatus.maxItems },
      'RSS→EA bridge ingestor enabled'
    );
  } else {
    logger.info({ reason: rssStatus?.reason || 'disabled' }, 'RSS→EA bridge ingestor disabled');
  }
} catch (_error) {
  // best-effort
}

// Allow TradeManager to gate signals on EA connectivity.
tradeManager.eaBridgeService = eaBridgeService;

// Allow EA-delivered quotes/news to enrich signal generation.
tradingEngine.setExternalMarketContextProvider?.(async ({ pair, broker }) => {
  const brokerId = broker ? String(broker).toLowerCase() : null;
  const quotes = eaBridgeService.getQuotes({
    broker: brokerId,
    symbols: [pair],
    maxAgeMs: 30 * 1000
  });
  const quote = Array.isArray(quotes) && quotes.length ? quotes[0] : null;

  // Snapshots are used to hydrate the dashboard analyzer (RSI/MACD/ATR/levels).
  // If we treat snapshots as stale too aggressively, the UI will sit on "Waiting for MT snapshot..."
  // even though the EA did post a snapshot recently.
  const SNAPSHOT_FRESH_MAX_AGE_MS = 5 * 60 * 1000;
  const SNAPSHOT_DISPLAY_MAX_AGE_MS = 30 * 60 * 1000;

  let snapshot = brokerId
    ? eaBridgeService.getMarketSnapshot({
        broker: brokerId,
        symbol: pair,
        maxAgeMs: SNAPSHOT_FRESH_MAX_AGE_MS
      })
    : null;

  // If no fresh snapshot, fall back to a slightly older one for display and request a refresh.
  if (!snapshot && brokerId) {
    const fallback = eaBridgeService.getMarketSnapshot({
      broker: brokerId,
      symbol: pair,
      maxAgeMs: SNAPSHOT_DISPLAY_MAX_AGE_MS
    });
    if (fallback) {
      snapshot = { ...fallback, stale: true };
    }

    // Trigger the EA to post a fresh snapshot for this symbol.
    try {
      eaBridgeService.requestMarketSnapshot({
        broker: brokerId,
        symbol: pair,
        ttlMs: 2 * 60 * 1000
      });
    } catch (_error) {
      // Best-effort; analysis can still proceed without a snapshot.
    }
  }

  const rawNews = eaBridgeService.getNews({ broker: brokerId, limit: 50 });

  const parseImpact = (value) => {
    if (value == null) {
      return null;
    }
    const raw = String(value).trim();
    const num = Number(raw);
    if (Number.isFinite(num)) {
      // Normalize to a 0-100 scale.
      // Providers sometimes report small numeric scales (e.g., 1-3 or 0-10).
      if (num <= 3) {
        return Math.max(0, Math.min(100, num * 30));
      }
      if (num <= 10) {
        return Math.max(0, Math.min(100, num * 10));
      }
      return Math.max(0, Math.min(100, num));
    }
    const lower = raw.toLowerCase();
    if (lower.includes('high')) {
      return 90;
    }
    if (lower.includes('medium')) {
      return 60;
    }
    if (lower.includes('low')) {
      return 30;
    }
    return null;
  };

  const boostCalendarImpact = (eventName, impact) => {
    const base = Number.isFinite(Number(impact)) ? Number(impact) : null;
    const name = String(eventName || '').toLowerCase();
    if (!name) {
      return base;
    }

    const isTier1 =
      name.includes('interest rate') ||
      name.includes('rate decision') ||
      name.includes('cpi') ||
      name.includes('inflation') ||
      name.includes('non-farm') ||
      name.includes('nonfarm') ||
      name.includes('nfp') ||
      name.includes('unemployment') ||
      name.includes('fomc') ||
      name.includes('gdp') ||
      name.includes('central bank') ||
      name.includes('powell');

    const isTier2 =
      name.includes('retail sales') ||
      name.includes('ppi') ||
      name.includes('pmi') ||
      name.includes('employment') ||
      name.includes('jobless') ||
      name.includes('consumer confidence') ||
      name.includes('industrial production') ||
      name.includes('speaks');

    if (isTier1) {
      return base != null ? Math.max(base, 95) : 95;
    }
    if (isTier2) {
      return base != null ? Math.max(base, 80) : 80;
    }
    return base;
  };

  const fallbackCalendarEvents = async () => {
    try {
      const events = await economicCalendarService.getEventsForPair(pair, { daysAhead: 3 });
      const list = Array.isArray(events) ? events : [];
      const mapped = list
        .map((evt) => {
          const currency = String(evt?.['ff:currency'] || evt?.currency || '')
            .trim()
            .toUpperCase();
          const iso = evt?.isoDate || evt?.time || evt?.date || null;
          const ts = Number.isFinite(Date.parse(String(iso))) ? Date.parse(String(iso)) : null;
          if (!currency || ts == null) {
            return null;
          }

          const providerRaw = String(evt?.source || evt?.provider || 'unknown')
            .trim()
            .toLowerCase();
          const isSynthetic = providerRaw.includes('synthetic');
          const provider = isSynthetic
            ? 'synthetic'
            : providerRaw.includes('finnhub')
              ? 'finnhub'
              : providerRaw.includes('rss') ||
                  providerRaw.includes('forex') ||
                  providerRaw.includes('ff')
                ? 'forexfactory'
                : providerRaw || 'unknown';

          const name = evt?.event || evt?.title || 'Economic Event';
          const baseImpact = parseImpact(evt?.impact);
          const boostedImpact = boostCalendarImpact(name, baseImpact);
          return {
            id: `ff:${currency}:${String(name).slice(0, 80)}:${ts}`,
            event: name,
            title: name,
            currency,
            impact: boostedImpact,
            time: new Date(ts).toISOString(),
            timestamp: ts,
            actual: evt?.actual ?? null,
            forecast: evt?.forecast ?? null,
            previous: evt?.previous ?? null,
            source: provider,
            receivedAt: Date.now(),
            raw: {
              provider,
              providerRaw,
              impact: evt?.impact ?? null,
              baseImpact: baseImpact,
              isoDate: evt?.isoDate ?? null
            }
          };
        })
        .filter(Boolean);

      // Prefer real providers; keep synthetic only if nothing else is available.
      const hasReal = mapped.some((e) => String(e?.source || '') !== 'synthetic');
      return hasReal ? mapped.filter((e) => String(e?.source || '') !== 'synthetic') : mapped;
    } catch (_error) {
      return [];
    }
  };

  const toEpochMs = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    // Heuristic: epoch seconds are typically < 1e11
    if (numeric < 1e11) {
      return Math.trunc(numeric * 1000);
    }
    return Math.trunc(numeric);
  };

  const toIsoOrNull = (value) => {
    const ms = toEpochMs(value);
    if (ms == null) {
      return null;
    }
    try {
      return new Date(ms).toISOString();
    } catch (_error) {
      return null;
    }
  };

  const isLikelyCalendarEvent = (item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const kind = String(item?.raw?.kind || item?.raw?.type || '')
      .trim()
      .toLowerCase();
    if (kind.includes('headline') || kind.includes('news')) {
      return false;
    }
    if (kind.includes('event') || kind.includes('calendar')) {
      return true;
    }

    const hasMacroFields = item.actual != null || item.forecast != null || item.previous != null;
    const hasCurrency = Boolean(String(item.currency || '').trim());
    const impact = Number(item.impact);
    const hasImpact = Number.isFinite(impact);

    // Treat currency-tagged items as economic calendar events by default.
    return Boolean(hasCurrency && (hasMacroFields || hasImpact));
  };

  const items = Array.isArray(rawNews) ? rawNews : [];
  let events = items
    .filter(isLikelyCalendarEvent)
    .slice(0, 50)
    .map((item) => {
      const ts =
        toEpochMs(item.time ?? item.timestamp ?? item.receivedAt) ??
        toEpochMs(item?.raw?.time ?? item?.raw?.timestamp ?? item?.raw?.date) ??
        Date.now();
      return {
        id: item.id || null,
        event: item.title || item.headline || 'EA Event',
        title: item.title || item.headline || 'EA Event',
        currency: item.currency || null,
        impact: Number.isFinite(Number(item.impact)) ? Number(item.impact) : null,
        time: toIsoOrNull(ts) || new Date().toISOString(),
        timestamp: ts,
        actual: item.actual ?? null,
        forecast: item.forecast ?? null,
        previous: item.previous ?? null,
        source: item.source || 'ea',
        receivedAt: item.receivedAt ?? null,
        raw: item.raw || null
      };
    });

  // If EA did not provide upcoming calendar events, fall back to the external calendar feed.
  // This keeps strict governors functional and surfaces upcoming high-impact events in the dashboard.
  if (events.length === 0) {
    const ffEvents = await fallbackCalendarEvents();
    if (ffEvents.length) {
      const seen = new Set(events.map((e) => String(e?.id || '')));
      for (const e of ffEvents) {
        const id = String(e?.id || '');
        if (id && !seen.has(id)) {
          events.push(e);
          seen.add(id);
        }
      }
      events = events.slice(0, 50);
    }
  }

  const isExplicitHeadline = (item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const kind = String(item?.raw?.kind || item?.raw?.type || '')
      .trim()
      .toLowerCase();
    return kind.includes('headline') || kind.includes('news');
  };

  // Prefer explicit headlines when present.
  // Fallback: if only calendar-tagged RSS items exist, treat them as headlines too so
  // the dashboard/engine can still show external headline evidence in EA-only mode.
  const explicitHeadlines = items.filter(isExplicitHeadline);
  const nonCalendar = items.filter((item) => !isLikelyCalendarEvent(item));
  const newsSource = explicitHeadlines.length
    ? explicitHeadlines
    : nonCalendar.length
      ? nonCalendar
      : items;

  const news = newsSource.slice(0, 50).map((item) => {
    const ts =
      toEpochMs(item.time ?? item.timestamp ?? item.receivedAt) ??
      toEpochMs(item?.raw?.time ?? item?.raw?.timestamp ?? item?.raw?.date) ??
      null;
    return {
      id: item.id || null,
      headline: item.title || item.headline || 'EA News',
      title: item.title || item.headline || 'EA News',
      source: item.source || item?.raw?.source || 'ea',
      timestamp: ts,
      publishedAt: ts,
      url: item?.raw?.url || item?.raw?.link || null,
      impact: Number.isFinite(Number(item.impact)) ? Number(item.impact) : null,
      score: null,
      sentimentLabel: null,
      currency: item.currency || null,
      symbol: item.symbol || null,
      receivedAt: item.receivedAt ?? null,
      raw: item.raw || null
    };
  });

  // Recent candles (EA bars preferred; quote-derived fallback). Used to strengthen EA-connected analysis.
  // NOTE: use maxAgeMs=0 to avoid filtering by receivedAt (we bound by limit instead).
  const barsByTimeframe = brokerId
    ? {
        M1: eaBridgeService.getMarketCandles({
          broker: brokerId,
          symbol: pair,
          timeframe: 'M1',
          limit: 90,
          maxAgeMs: 0
        }),
        M15: eaBridgeService.getMarketCandles({
          broker: brokerId,
          symbol: pair,
          timeframe: 'M15',
          limit: 240,
          maxAgeMs: 0
        }),
        H1: eaBridgeService.getMarketCandles({
          broker: brokerId,
          symbol: pair,
          timeframe: 'H1',
          limit: 240,
          maxAgeMs: 0
        }),
        H4: eaBridgeService.getMarketCandles({
          broker: brokerId,
          symbol: pair,
          timeframe: 'H4',
          limit: 180,
          maxAgeMs: 0
        }),
        D1: eaBridgeService.getMarketCandles({
          broker: brokerId,
          symbol: pair,
          timeframe: 'D1',
          limit: 180,
          maxAgeMs: 0
        })
      }
    : { M1: [], M15: [], H1: [], H4: [], D1: [] };

  const bars = Array.isArray(barsByTimeframe.M1) ? barsByTimeframe.M1 : [];

  return {
    quote,
    snapshot,
    news,
    events,
    bars,
    barsTimeframe: 'M1',
    barsByTimeframe
  };
});

// Initialize optional services
let riskReportService;
let brokerReconciliationService;
let performanceDigestService;

// Provider availability persistence adapter
const availabilityPersistenceAdapter = tradingEngine?.persistence || null;
const loadProviderAvailabilityHistory =
  availabilityPersistenceAdapter?.getProviderAvailabilityHistory
    ? (options) => availabilityPersistenceAdapter.getProviderAvailabilityHistory(options)
    : null;

// Initialize pair prefetch scheduler
const schedulerOptions = {};
if (
  Number.isFinite(pairPrefetchSettings.tickIntervalMs) &&
  pairPrefetchSettings.tickIntervalMs > 0
) {
  schedulerOptions.tickIntervalMs = pairPrefetchSettings.tickIntervalMs;
}
if (
  Number.isFinite(pairPrefetchSettings.maxPairsPerTick) &&
  pairPrefetchSettings.maxPairsPerTick > 0
) {
  schedulerOptions.maxPairsPerTick = pairPrefetchSettings.maxPairsPerTick;
}
const pairPrefetchScheduler = new PairPrefetchScheduler({
  priceDataFetcher: tradingEngine.priceDataFetcher,
  catalog: pairCatalog.filter((instrument) => instrument.enabled !== false),
  logger,
  options: schedulerOptions
});

// Start optional services
if (serviceToggles.riskReports?.enabled) {
  riskReportService = new RiskReportService({
    tradingEngine,
    alertBus,
    logger,
    reportHourUtc: serviceToggles.riskReports.reportHourUtc
  });
  riskReportService.start();
  logger.info('Daily risk report service started');
} else {
  logger.warn('Daily risk report service disabled via configuration toggle');
}

if (serviceToggles.performanceDigests?.enabled) {
  performanceDigestService = new PerformanceDigestService({
    tradingEngine,
    alertBus,
    logger,
    reportHourUtc: serviceToggles.performanceDigests.reportHourUtc,
    outputDir: serviceToggles.performanceDigests.outputDir,
    includePdf: serviceToggles.performanceDigests.includePdf
  });
  performanceDigestService.start();
  logger.info(
    { outputDir: performanceDigestService.outputDir },
    'Performance digest service started'
  );
} else {
  logger.warn('Performance digest service disabled via configuration toggle');
}

if (config.brokerRouting?.enabled) {
  brokerReconciliationService = new BrokerReconciliationService({
    brokerRouter,
    tradingEngine,
    logger,
    intervalMs: serviceToggles.brokerReconciliation?.intervalMs || 60000
  });
  brokerReconciliationService.start();
}

if (pairPrefetchSettings.enabled) {
  pairPrefetchScheduler.start();
} else {
  logger.warn('Pair prefetch scheduler disabled via configuration toggle');
}

// Auto-start trading if configured
const autoTradingAutostart = autoTradingConfig.autostart;
if (autoTradingAutostart) {
  // MT4/MT5 EAs often connect *after* the server boots. One-shot autostart can miss that.
  // Keep retrying until the broker is connected, then confirm automation is enabled.
  const autostartRetryMs = Number.isFinite(Number(process.env.AUTO_TRADING_AUTOSTART_RETRY_MS))
    ? Math.max(2000, Number(process.env.AUTO_TRADING_AUTOSTART_RETRY_MS))
    : 15000;
  // By default, do NOT give up. The EA might connect much later.
  const autostartMaxAttemptsRaw = Number(process.env.AUTO_TRADING_AUTOSTART_MAX_ATTEMPTS);
  const autostartMaxAttempts = Number.isFinite(autostartMaxAttemptsRaw)
    ? Math.max(1, autostartMaxAttemptsRaw)
    : null;

  let autostartAttempts = 0;
  let autostartTimer = null;

  const autostartBroker =
    tradeManager.normalizeBrokerId?.(process.env.AUTO_TRADING_AUTOSTART_BROKER) ||
    tradeManager.normalizeBrokerId?.(process.env.AUTO_TRADING_BROKER) ||
    tradeManager.getDefaultBrokerId?.() ||
    null;

  const attemptAutostart = async () => {
    autostartAttempts += 1;

    try {
      if (!autostartBroker) {
        logger.warn('Auto trading auto-start pending: no broker resolved');
        return;
      }

      const connected = await tradeManager.isBrokerConnected(autostartBroker);
      const enabled = tradeManager.isAutoTradingEnabled(autostartBroker);

      // If automation is enabled AND the EA is actually connected, we're done.
      if (enabled && connected) {
        logger.info({ broker: autostartBroker }, 'Auto trading auto-started (EA connected)');
        if (autostartTimer) {
          clearInterval(autostartTimer);
          autostartTimer = null;
        }
        return;
      }

      // If not enabled yet, enable it (even if disconnected) and keep waiting.
      if (!enabled) {
        const result = await tradeManager.startAutoTrading({
          broker: autostartBroker,
          allowDisconnected: true
        });
        logger.info(
          {
            broker: result?.broker || autostartBroker,
            connected: result?.connected,
            pairs: result?.pairs,
            interval: result?.checkIntervalMs
          },
          'Auto trading autostart enabled (waiting for EA connection)'
        );
        return;
      }

      // Enabled already, still waiting on EA connectivity.
      logger.warn(
        { broker: autostartBroker, attempt: autostartAttempts, maxAttempts: autostartMaxAttempts },
        'Auto trading auto-start pending (EA offline)'
      );
    } catch (error) {
      logger.error(
        { err: error, attempt: autostartAttempts, maxAttempts: autostartMaxAttempts },
        'Failed to auto-start trading manager'
      );
    }

    if (autostartMaxAttempts != null && autostartAttempts >= autostartMaxAttempts) {
      logger.warn(
        { attempts: autostartAttempts, retryMs: autostartRetryMs },
        'Auto trading auto-start gave up; broker may be offline'
      );
      if (autostartTimer) {
        clearInterval(autostartTimer);
        autostartTimer = null;
      }
    }
  };

  // First attempt immediately, then retry in the background.
  void attemptAutostart();
  autostartTimer = setInterval(() => {
    void attemptAutostart();
  }, autostartRetryMs);
  autostartTimer.unref?.();
} else {
  logger.info('Auto trading auto-start disabled; awaiting manual start command');
}

// Provider availability state for health routes
const providerAvailabilityState = {
  buildSnapshot: ({ timeframes, requireHealthyQuality, qualityThreshold }) =>
    buildProviderAvailabilitySnapshot({
      priceDataFetcher: tradingEngine.priceDataFetcher,
      timeframes,
      requireHealthyQuality,
      qualityThreshold
    }),
  providerAvailabilityAlertConfig,
  history: providerAvailabilityHistory,
  historyLimit: providerAvailabilityHistoryLimit,
  loadProviderAvailabilityHistory
};

// Start the server - all routes are mounted via route modules in `src/app/http.js`
const {
  app,
  server,
  websocketLayer: _websocketLayer
} = startServer({
  serverConfig,
  tradingEngine,
  tradeManager,
  heartbeatMonitor,
  brokerRouter,
  eaBridgeService,
  secretManager,
  auditLogger,
  logger,
  alertBus,
  pairPrefetchScheduler,
  services: serviceToggles,
  metricsRegistry,
  providerAvailabilityState,
  onClose: () => {
    pairPrefetchScheduler.stop();
    riskReportService?.stop?.();
    brokerReconciliationService?.stop?.();
  }
});

// Feed auto-trading execution outcomes into the WebSocket event stream.
// This lets the dashboard show auto-trade attempts, rejects, and opened trades.
try {
  if (_websocketLayer?.broadcast) {
    tradeManager.emit = _websocketLayer.broadcast;
    tradingEngine.emit = _websocketLayer.broadcast;
  }
} catch (_error) {
  // best-effort
}

let shutdownInProgress = false;
shutdownHook = (signal, error) => {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;

  // Always print shutdown reason for easier diagnosis in dev.
  console.error('[shutdown]', signal, error?.stack || error || '(no error)');

  logger.warn({ signal, err: error }, 'Shutdown requested');
  try {
    tradeManager?.stopAutoTrading?.();
  } catch (stopError) {
    logger.warn({ err: stopError }, 'Failed to stop auto trading during shutdown');
  }

  const timeoutMs = Number.isFinite(serverConfig?.shutdownTimeoutMs)
    ? Math.max(1000, serverConfig.shutdownTimeoutMs)
    : 15000;

  const forceTimer = setTimeout(() => {
    logger.error({ timeoutMs }, 'Forcing process exit after shutdown timeout');
    process.exit(1);
  }, timeoutMs);
  forceTimer.unref?.();

  try {
    server.close(() => {
      clearTimeout(forceTimer);
      logger.info('HTTP server closed');
      process.exit(error ? 1 : 0);
    });
  } catch (closeError) {
    clearTimeout(forceTimer);
    logger.error({ err: closeError }, 'Failed to close HTTP server');
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdownHook('SIGINT'));
process.on('SIGTERM', () => shutdownHook('SIGTERM'));

export { app, server, tradingEngine, tradeManager, brokerRouter, eaBridgeService };
