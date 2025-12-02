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
import SecretManager from './services/security/secret-manager.js';
import AuditLogger from './services/logging/audit-logger.js';
import { metrics as metricsRegistry } from './services/metrics.js';
import PairPrefetchScheduler from './services/pair-prefetch-scheduler.js';
import { pairCatalog } from './config/pair-catalog.js';
import {
  getServerConfig,
  getTradingConfig,
  getBrokerConfig,
  getServiceToggles,
  getAutoTradingConfig,
  getDatabaseConfig,
  getRawEnv,
  getPairPrefetchSettings,
  getFullAppConfig
} from './app/config-service.js';
import { startServer } from './app/startup.js';
import { buildProviderAvailabilitySnapshot } from './services/health-summary.js';

// Load configuration
const serverConfig = getServerConfig();
const tradingConfig = getTradingConfig();
const { brokers: brokerConfig, brokerRouting: brokerRoutingConfig } = getBrokerConfig();
const serviceToggles = getServiceToggles();
const pairPrefetchSettings = getPairPrefetchSettings();
const autoTradingConfig = getAutoTradingConfig();
const databaseConfig = getDatabaseConfig();
const rawEnv = getRawEnv();
const fullAppConfig = getFullAppConfig();
const alertingConfig = fullAppConfig.alerting;

// Provider availability state
const providerAvailabilityHistoryLimit = Number.isFinite(
  serverConfig.providerAvailabilityHistoryLimit
)
  ? Math.max(1, serverConfig.providerAvailabilityHistoryLimit)
  : 288;
const providerAvailabilityAlertConfig = serverConfig.providerAvailabilityAlert || {};
const providerAvailabilityHistory = [];

// Initialize core services
const secretManager = new SecretManager({ logger });
const auditLogger = new AuditLogger({ logger });

void auditLogger.init().catch((error) => {
  logger.error({ err: error }, 'Failed to initialize audit logger');
});

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
  defaultBroker: brokerRoutingConfig.defaultBroker || 'mt5',
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
  logger.error({ err: error }, 'Real-time data configuration error');
  if (error.code === 'REALTIME_DATA_REQUIRED') {
    logger.error(
      'Set ALLOW_SYNTHETIC_DATA=true temporarily if you need to bypass live data checks during development.'
    );
  }
  process.exit(1);
}

// Log API keys status
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
  'API keys configuration status'
);

const missingPriceProviders = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'].filter(
  (key) => !config.apiKeys[key]
);
if (missingPriceProviders.length > 0) {
  logger.warn({ providers: missingPriceProviders }, 'Real-time price data providers missing keys');
  logger.warn('Price fetcher will fall back to cached/simulated data if live calls fail.');
}

if (!config.apiKeys.fred) {
  logger.warn(
    'FRED_API_KEY is not configured. Retail sales and manufacturing metrics will be unavailable.'
  );
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
  tradeManager
    .startAutoTrading()
    .then((result) => {
      if (result?.success) {
        logger.info(
          { pairs: result.pairs, interval: result.checkInterval },
          'Auto trading auto-started'
        );
      } else {
        logger.warn(
          { message: result?.message },
          'Auto trading auto-start returned without enabling'
        );
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Failed to auto-start trading manager');
    });
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

export { app, server, tradingEngine, tradeManager, brokerRouter };
