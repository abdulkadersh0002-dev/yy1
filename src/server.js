/**
 * Intelligent Auto-Trading Server
 * REST API for automated trading system with real-time monitoring
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { createApiAuthMiddleware } from './middleware/api-auth.js';
import {
  buildHealthzPayload,
  buildModuleHealthSummary,
  buildProviderAvailabilitySnapshot,
  classifyProviderAvailabilitySnapshot,
  summarizeProviderAvailabilityHistory
} from './services/health-summary.js';
import {
  metrics as metricsRegistry,
  observeSignalGeneration,
  recordTradeExecution,
  updateProviderAvailabilityMetrics
} from './services/metrics.js';
import PairPrefetchScheduler from './services/pair-prefetch-scheduler.js';
import { pairCatalog } from './config/pair-catalog.js';
import { appConfig } from './app/config.js';

const app = express();
const server = createServer(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const durationSecondsFrom = (start) => Number(process.hrtime.bigint() - start) / 1e9;

const {
  server: serverConfig,
  apiAuth: apiAuthConfig,
  trading: tradingConfig,
  alerting: alertingConfig,
  brokers: brokerConfig,
  brokerRouting: brokerRoutingConfig,
  services: serviceToggles,
  pairPrefetch: pairPrefetchSettings,
  autoTrading: autoTradingConfig,
  database: databaseConfig,
  env: rawEnv
} = appConfig;

const secretManager = new SecretManager({ logger });
const auditLogger = new AuditLogger({ logger });

void auditLogger.init().catch((error) => {
  logger.error({ err: error }, 'Failed to initialize audit logger');
});

const requestBodyLimit = serverConfig.requestJsonLimit;
app.use(compression());
app.use(cors());
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

const websocketClients = new Set();
const enableWebSockets = serverConfig.enableWebSockets;
const websocketPath = serverConfig.websocketPath;
const websocketPingIntervalMs = serverConfig.websocketPingIntervalMs;
let websocketHeartbeat;
let wss;

const providerAvailabilityBroadcastMs = Number.isFinite(
  serverConfig.providerAvailabilityBroadcastIntervalMs
)
  ? Math.max(0, serverConfig.providerAvailabilityBroadcastIntervalMs)
  : 20_000;
const providerAvailabilityTimeframes =
  Array.isArray(serverConfig.providerAvailabilityTimeframes) &&
  serverConfig.providerAvailabilityTimeframes.length > 0
    ? serverConfig.providerAvailabilityTimeframes
    : undefined;
const providerAvailabilityHistoryLimit = Number.isFinite(
  serverConfig.providerAvailabilityHistoryLimit
)
  ? Math.max(1, serverConfig.providerAvailabilityHistoryLimit)
  : 288;
const providerAvailabilityAlertConfig = serverConfig.providerAvailabilityAlert || {};
let providerAvailabilityInterval;
let lastProviderAvailabilityDigest = null;
let latestProviderAvailabilitySnapshot = null;
let latestProviderAvailabilityClassification = null;
const providerAvailabilityHistory = [];
let lastProviderAvailabilityState = 'unknown';
let lastProviderAvailabilityReason = 'unknown';
let lastProviderAlertAt = 0;

const broadcast = (type, payload) => {
  if (!enableWebSockets || websocketClients.size === 0) {
    return;
  }

  const message = JSON.stringify({
    type,
    payload,
    timestamp: Date.now()
  });

  for (const client of websocketClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        logger.warn({ err: error }, 'Failed to broadcast WebSocket message');
      }
    }
  }
};

if (enableWebSockets) {
  wss = new WebSocketServer({ server, path: websocketPath });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    websocketClients.add(socket);
    logger.info({ activeClients: websocketClients.size }, 'WebSocket client connected');

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('close', () => {
      websocketClients.delete(socket);
      logger.info({ activeClients: websocketClients.size }, 'WebSocket client disconnected');
    });

    socket.on('error', (error) => {
      logger.warn({ err: error }, 'WebSocket client error');
    });

    try {
      socket.send(
        JSON.stringify({
          type: 'connected',
          timestamp: Date.now()
        })
      );
    } catch (error) {
      logger.warn({ err: error }, 'Failed to send WebSocket welcome message');
    }

    if (latestProviderAvailabilitySnapshot) {
      try {
        socket.send(
          JSON.stringify({
            type: 'provider_availability',
            payload: latestProviderAvailabilitySnapshot,
            timestamp: Date.now()
          })
        );
      } catch (error) {
        logger.warn(
          { err: error },
          'Failed to send provider availability snapshot to WebSocket client'
        );
      }
    }
  });

  const heartbeatInterval = websocketPingIntervalMs > 5000 ? websocketPingIntervalMs : 30000;
  websocketHeartbeat = setInterval(() => {
    for (const socket of websocketClients) {
      if (socket.readyState !== WebSocket.OPEN) {
        websocketClients.delete(socket);
        continue;
      }

      if (socket.isAlive === false) {
        websocketClients.delete(socket);
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      try {
        socket.ping();
      } catch (error) {
        logger.warn({ err: error }, 'WebSocket ping failed');
        websocketClients.delete(socket);
        socket.terminate();
      }
    }
  }, heartbeatInterval);

  logger.info({ path: websocketPath }, 'WebSocket server initialized');
} else {
  logger.info('WebSocket broadcasting disabled via ENABLE_WEBSOCKETS flag');
}

const apiAuth = createApiAuthMiddleware({
  enabled: apiAuthConfig.enabled,
  secretManager,
  logger,
  auditLogger,
  exemptRoutes: [
    { method: 'GET', path: /^\/api\/health(\/.*)?$/ },
    { method: 'GET', path: /^\/api\/health\/heartbeat(\/.*)?$/ },
    { method: 'GET', path: /^\/metrics$/ },
    { path: /^\/api\/client(\/.*)?$/ }
  ]
});

const requireBasicRead = apiAuth.requireAnyRole(['read.basic', 'admin']);
const requireRiskRead = apiAuth.requireAnyRole(['risk.read', 'admin']);
const requireBrokerRead = apiAuth.requireAnyRole(['broker.read', 'admin']);
const requireBrokerWrite = apiAuth.requireAnyRole(['broker.write', 'admin']);
const requireSignalsGenerate = apiAuth.requireAnyRole(['signals.generate', 'admin']);
const requireTradeExecute = apiAuth.requireAnyRole(['trade.execute', 'admin']);
const requireTradeClose = apiAuth.requireAnyRole(['trade.close', 'trade.execute', 'admin']);
const requireTradeRead = apiAuth.requireAnyRole(['trade.read', 'admin']);
const requireAutomationControl = apiAuth.requireAnyRole(['automation.control', 'admin']);
const requireConfigRead = apiAuth.requireAnyRole(['config.read', 'admin']);
const requireConfigWrite = apiAuth.requireAnyRole(['config.write', 'admin']);

app.use('/api', apiAuth.authenticate);

const config = { ...tradingConfig };

const alertBus = new AlertBus({
  slackWebhookUrl: alertingConfig.slackWebhookUrl,
  webhookUrls: alertingConfig.webhookUrls,
  email: alertingConfig.email,
  dedupeMs: alertingConfig.dedupeMs,
  logger
});

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

config.brokerRouting = {
  ...brokerRoutingConfig
};

config.dependencies = {
  ...(config.dependencies || {}),
  alertBus,
  brokerRouter: config.brokerRouting?.enabled ? brokerRouter : null
};

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

// Log API keys status (without exposing full keys)
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

const tradingEngine = new TradingEngine(config);
if (config.brokerRouting?.enabled) {
  tradingEngine.setBrokerRouter(brokerRouter);
}
const tradeManager = new TradeManager(tradingEngine);
const heartbeatMonitor = new HeartbeatMonitor({ tradingEngine, tradeManager });
let riskReportService;
let brokerReconciliationService;
let performanceDigestService;
const availabilityPersistenceAdapter = tradingEngine?.persistence || null;
const persistProviderAvailabilitySnapshot =
  availabilityPersistenceAdapter?.recordProviderAvailabilitySnapshot
    ? (payload) => availabilityPersistenceAdapter.recordProviderAvailabilitySnapshot(payload)
    : null;
const loadProviderAvailabilityHistory =
  availabilityPersistenceAdapter?.getProviderAvailabilityHistory
    ? (options) => availabilityPersistenceAdapter.getProviderAvailabilityHistory(options)
    : null;
const primeProviderAvailabilityHistory = async () => {
  if (!loadProviderAvailabilityHistory) {
    return;
  }
  try {
    const persisted = await loadProviderAvailabilityHistory({
      limit: providerAvailabilityHistoryLimit,
      order: 'asc'
    });
    if (!Array.isArray(persisted) || persisted.length === 0) {
      return;
    }

    providerAvailabilityHistory.splice(0, providerAvailabilityHistory.length);
    for (const entry of persisted) {
      const timestamp = entry.captured_at || entry.capturedAt;
      providerAvailabilityHistory.push({
        timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
        state: entry.state || 'unknown',
        severity: entry.severity || 'info',
        reason: entry.reason || null,
        aggregateQuality: entry.aggregate_quality != null ? Number(entry.aggregate_quality) : null,
        normalizedQuality:
          entry.normalized_quality != null ? Number(entry.normalized_quality) : null,
        unavailableProviders: Array.isArray(entry.unavailable_providers)
          ? [...entry.unavailable_providers]
          : [],
        breakerProviders: Array.isArray(entry.breaker_providers)
          ? [...entry.breaker_providers]
          : [],
        blockedTimeframes: Array.isArray(entry.blocked_timeframes)
          ? [...entry.blocked_timeframes]
          : [],
        blockedProviderRatio:
          entry.blocked_provider_ratio != null ? Number(entry.blocked_provider_ratio) : null,
        blockedTimeframeRatio:
          entry.blocked_timeframe_ratio != null ? Number(entry.blocked_timeframe_ratio) : null,
        detail: entry.detail || null
      });
    }

    const latestPersisted = providerAvailabilityHistory[providerAvailabilityHistory.length - 1];
    if (latestPersisted) {
      lastProviderAvailabilityState = latestPersisted.state || 'unknown';
      lastProviderAvailabilityReason = latestPersisted.reason || 'unknown';
    }
  } catch (error) {
    logger.warn({ err: error }, 'Failed to load provider availability history from persistence');
  }
};

void primeProviderAvailabilityHistory();
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

if (enableWebSockets && providerAvailabilityBroadcastMs > 0) {
  const emitProviderAvailability = () => {
    try {
      const snapshot = buildProviderAvailabilitySnapshot({
        priceDataFetcher: tradingEngine.priceDataFetcher,
        timeframes: providerAvailabilityTimeframes
      });

      const classification = classifyProviderAvailabilitySnapshot(
        snapshot,
        providerAvailabilityAlertConfig
      );
      latestProviderAvailabilityClassification = classification;

      const historyEntry = {
        timestamp: snapshot.timestamp,
        state: classification.state,
        severity: classification.severity,
        reason: classification.reason,
        aggregateQuality: snapshot.aggregateQuality,
        normalizedQuality: classification.metrics.normalizedQuality,
        unavailableProviders: Array.isArray(classification.context?.unavailableProviders)
          ? [...classification.context.unavailableProviders]
          : [],
        breakerProviders: Array.isArray(classification.context?.breakerProviders)
          ? [...classification.context.breakerProviders]
          : [],
        blockedTimeframes: Array.isArray(classification.context?.blockedTimeframes)
          ? [...classification.context.blockedTimeframes]
          : [],
        blockedProviderRatio: classification.metrics.blockedProviderRatio,
        blockedTimeframeRatio: classification.metrics.blockedTimeframeRatio,
        detail: classification.detail
      };
      providerAvailabilityHistory.push(historyEntry);
      while (providerAvailabilityHistory.length > providerAvailabilityHistoryLimit) {
        providerAvailabilityHistory.shift();
      }

      if (persistProviderAvailabilitySnapshot) {
        Promise.resolve(
          persistProviderAvailabilitySnapshot({
            timestamp: new Date(snapshot.timestamp),
            state: classification.state,
            severity: classification.severity,
            reason: classification.reason,
            aggregateQuality: snapshot.aggregateQuality,
            normalizedQuality: classification.metrics.normalizedQuality,
            unavailableProviders: Array.isArray(classification.context?.unavailableProviders)
              ? [...classification.context.unavailableProviders]
              : [],
            breakerProviders: Array.isArray(classification.context?.breakerProviders)
              ? [...classification.context.breakerProviders]
              : [],
            blockedTimeframes: Array.isArray(classification.context?.blockedTimeframes)
              ? [...classification.context.blockedTimeframes]
              : [],
            blockedProviderRatio: classification.metrics.blockedProviderRatio,
            blockedTimeframeRatio: classification.metrics.blockedTimeframeRatio,
            detail: classification.detail,
            metadata: {
              providerOrder: Array.isArray(classification.context?.providerOrder)
                ? [...classification.context.providerOrder]
                : [],
              reasons: Array.isArray(classification.context?.reasons)
                ? [...classification.context.reasons]
                : [],
              defaultAvailability: snapshot.defaultAvailability,
              rateLimits: snapshot.rateLimits,
              providers: Array.isArray(snapshot.providers)
                ? snapshot.providers.map((providerEntry) => ({
                    provider: providerEntry.provider,
                    available: providerEntry.available !== false,
                    disabled: providerEntry.disabled === true,
                    circuitBreakerActive: providerEntry.circuitBreakerActive === true,
                    reasons: Array.isArray(providerEntry.reasons) ? [...providerEntry.reasons] : [],
                    normalizedQuality: Number.isFinite(providerEntry.metrics?.normalizedQuality)
                      ? Number(providerEntry.metrics.normalizedQuality)
                      : null,
                    avgLatencyMs: Number.isFinite(providerEntry.metrics?.avgLatencyMs)
                      ? Number(providerEntry.metrics.avgLatencyMs)
                      : null,
                    success: Number.isFinite(providerEntry.metrics?.success)
                      ? Number(providerEntry.metrics.success)
                      : null,
                    failed: Number.isFinite(providerEntry.metrics?.failed)
                      ? Number(providerEntry.metrics.failed)
                      : null,
                    rateLimited: Number.isFinite(providerEntry.metrics?.rateLimited)
                      ? Number(providerEntry.metrics.rateLimited)
                      : null
                  }))
                : [],
              timeframes: Array.isArray(snapshot.timeframes)
                ? snapshot.timeframes.map((timeframeEntry) => ({
                    timeframe: timeframeEntry.timeframe,
                    viable: timeframeEntry.viable !== false,
                    normalizedQuality: Number.isFinite(timeframeEntry.normalizedQuality)
                      ? Number(timeframeEntry.normalizedQuality)
                      : null,
                    reasons: Array.isArray(timeframeEntry.reasons)
                      ? [...timeframeEntry.reasons]
                      : []
                  }))
                : []
            }
          })
        ).catch((error) => {
          logger.debug({ err: error }, 'Failed to persist provider availability snapshot');
        });
      }

      const historyStats = summarizeProviderAvailabilityHistory(providerAvailabilityHistory);
      updateProviderAvailabilityMetrics({
        state: classification.state,
        historyStats,
        providers: Array.isArray(snapshot.providers) ? snapshot.providers : []
      });
      const historyClone = providerAvailabilityHistory.map((entry) => ({
        ...entry,
        unavailableProviders: Array.isArray(entry.unavailableProviders)
          ? [...entry.unavailableProviders]
          : [],
        breakerProviders: Array.isArray(entry.breakerProviders) ? [...entry.breakerProviders] : [],
        blockedTimeframes: Array.isArray(entry.blockedTimeframes)
          ? [...entry.blockedTimeframes]
          : []
      }));
      const snapshotWithClassification = {
        ...snapshot,
        classification,
        history: historyClone,
        historyStats,
        historyLimit: providerAvailabilityHistoryLimit,
        historyStorage: {
          inMemorySamples: providerAvailabilityHistory.length,
          persistenceEnabled: Boolean(loadProviderAvailabilityHistory)
        }
      };
      latestProviderAvailabilitySnapshot = snapshotWithClassification;

      const alertBusAvailable = Boolean(alertBus && typeof alertBus.publish === 'function');
      const alertsEnabled = providerAvailabilityAlertConfig.enabled !== false;
      if (alertsEnabled && alertBusAvailable) {
        const now = Date.now();
        const stateChanged = classification.state !== lastProviderAvailabilityState;
        const reasonChanged = classification.reason !== lastProviderAvailabilityReason;
        const cooldownMs = Number.isFinite(providerAvailabilityAlertConfig.cooldownMs)
          ? Math.max(0, providerAvailabilityAlertConfig.cooldownMs)
          : 10 * 60 * 1000;
        const cooldownElapsed = now - lastProviderAlertAt >= cooldownMs;
        const isDegradedState =
          classification.state === 'degraded' || classification.state === 'critical';

        if (stateChanged || reasonChanged || (isDegradedState && cooldownElapsed)) {
          const dedupeKey = `provider_availability|${classification.state}|${classification.reason}`;
          Promise.resolve(
            alertBus.publish({
              topic: 'provider_availability',
              severity: classification.severity,
              message: classification.message,
              body: classification.detail,
              context: {
                state: classification.state,
                reason: classification.reason,
                metrics: classification.metrics,
                ...classification.context
              },
              dedupeKey
            })
          ).catch((error) => {
            logger.warn({ err: error }, 'Provider availability alert publish failed');
          });
          lastProviderAlertAt = now;
        }
      }

      lastProviderAvailabilityState = classification.state;
      lastProviderAvailabilityReason = classification.reason;

      const digestPayload = JSON.stringify({
        providers: snapshot.providers.map((entry) => ({
          provider: entry.provider,
          available: entry.available,
          reasons: entry.reasons,
          disabled: entry.disabled,
          circuitBreakerActive: entry.circuitBreakerActive
        })),
        timeframes: snapshot.timeframes.map((entry) => ({
          timeframe: entry.timeframe,
          viable: entry.viable,
          reasons: entry.reasons
        })),
        aggregateQuality: snapshot.aggregateQuality,
        classification: {
          state: classification.state,
          reason: classification.reason,
          severity: classification.severity
        }
      });

      const hasClients = websocketClients.size > 0;
      if (digestPayload === lastProviderAvailabilityDigest && !hasClients) {
        return;
      }

      lastProviderAvailabilityDigest = digestPayload;

      if (hasClients) {
        broadcast('provider_availability', snapshotWithClassification);
      }
    } catch (error) {
      logger.debug({ err: error }, 'Provider availability broadcast failed');
    }
  };

  emitProviderAvailability();
  providerAvailabilityInterval = setInterval(
    emitProviderAvailability,
    providerAvailabilityBroadcastMs
  );
}

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

app.get('/api/risk/command-center', requireRiskRead, (req, res) => {
  if (config.riskCommandCenter?.enabled === false) {
    return res.status(503).json({ success: false, error: 'Risk command center disabled' });
  }
  try {
    const snapshot = tradingEngine.getRiskCommandSnapshot?.();
    res.json({
      success: true,
      snapshot,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to build risk command center snapshot');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/broker/status', requireBrokerRead, async (req, res) => {
  if (!config.brokerRouting?.enabled) {
    return res.status(503).json({ success: false, error: 'Broker routing disabled' });
  }
  try {
    const status = brokerRouter.getStatus();
    const health = await brokerRouter.getHealthSnapshots();
    res.json({
      success: true,
      status,
      health,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Broker status retrieval failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/broker/kill-switch', requireBrokerWrite, (req, res) => {
  if (!config.brokerRouting?.enabled) {
    return res.status(503).json({ success: false, error: 'Broker routing disabled' });
  }
  try {
    const { enabled, reason } = req.body || {};
    const state = brokerRouter.setKillSwitch(Boolean(enabled), reason);
    void auditLogger.record('broker.kill_switch', {
      enabled: Boolean(enabled),
      reason: reason || null,
      actor: req.identity?.id || 'unknown'
    });
    res.json({ success: true, state, timestamp: Date.now() });
  } catch (error) {
    logger.error({ err: error }, 'Kill switch update failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/broker/manual-order', requireBrokerWrite, async (req, res) => {
  if (!config.brokerRouting?.enabled) {
    return res.status(503).json({ success: false, error: 'Broker routing disabled' });
  }
  try {
    const payload = {
      ...req.body,
      source: 'manual-override'
    };
    const result = await brokerRouter.manualOrder(payload);
    void auditLogger.record('broker.manual_order', {
      actor: req.identity?.id || 'unknown',
      payload: {
        pair: payload.pair,
        direction: payload.direction,
        broker: payload.broker || brokerRouter.defaultBroker
      },
      success: Boolean(result.success)
    });
    res.json({ success: result.success, result, timestamp: Date.now() });
  } catch (error) {
    logger.error({ err: error }, 'Manual order failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/broker/manual-close', requireBrokerWrite, async (req, res) => {
  if (!config.brokerRouting?.enabled) {
    return res.status(503).json({ success: false, error: 'Broker routing disabled' });
  }
  try {
    const payload = {
      ...req.body,
      source: 'manual-override'
    };
    const result = await brokerRouter.closePosition(payload);
    if (result.success && payload.tradeId && tradingEngine.activeTrades?.has(payload.tradeId)) {
      try {
        const trade = tradingEngine.activeTrades.get(payload.tradeId);
        const currentPrice = await tradingEngine.getCurrentPriceForPair(trade.pair);
        await tradingEngine.closeTrade(payload.tradeId, currentPrice, 'manual_broker_close');
      } catch (error) {
        logger.warn({ err: error, tradeId: payload.tradeId }, 'Manual close sync failed');
      }
    }
    void auditLogger.record('broker.manual_close', {
      actor: req.identity?.id || 'unknown',
      tradeId: payload.tradeId || null,
      broker: payload.broker || brokerRouter.defaultBroker,
      success: Boolean(result.success)
    });
    res.json({ success: result.success, result, timestamp: Date.now() });
  } catch (error) {
    logger.error({ err: error }, 'Manual close failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/healthz', (req, res) => {
  const payload = buildHealthzPayload({
    tradingEngine,
    tradeManager,
    heartbeatMonitor
  });

  const statusCode = payload.status === 'critical' ? 503 : 200;
  res.status(statusCode).json(payload);
});

app.get('/api/health/modules', (req, res) => {
  const summary = buildModuleHealthSummary({
    tradingEngine,
    tradeManager,
    heartbeatMonitor
  });

  res.json({
    success: true,
    overall: summary.overall,
    modules: summary.modules,
    heartbeat: summary.heartbeat
  });
});

app.get('/api/health/providers', (req, res) => {
  try {
    let timeframes;
    if (Array.isArray(req.query.timeframes)) {
      timeframes = req.query.timeframes;
    } else if (req.query.timeframes) {
      timeframes = String(req.query.timeframes)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
    }

    const qualityThresholdRaw =
      req.query.qualityThreshold != null ? Number(req.query.qualityThreshold) : undefined;

    const snapshot = buildProviderAvailabilitySnapshot({
      priceDataFetcher: tradingEngine.priceDataFetcher,
      timeframes,
      requireHealthyQuality: req.query.requireHealthyQuality === 'false' ? false : true,
      qualityThreshold: Number.isFinite(qualityThresholdRaw) ? qualityThresholdRaw : undefined
    });

    const classification = classifyProviderAvailabilitySnapshot(
      snapshot,
      providerAvailabilityAlertConfig
    );
    const history = providerAvailabilityHistory.map((entry) => ({
      ...entry,
      unavailableProviders: Array.isArray(entry.unavailableProviders)
        ? [...entry.unavailableProviders]
        : [],
      breakerProviders: Array.isArray(entry.breakerProviders) ? [...entry.breakerProviders] : [],
      blockedTimeframes: Array.isArray(entry.blockedTimeframes) ? [...entry.blockedTimeframes] : []
    }));
    const historyStats = summarizeProviderAvailabilityHistory(providerAvailabilityHistory);

    const latestClassification = latestProviderAvailabilityClassification
      ? { ...latestProviderAvailabilityClassification }
      : null;

    res.json({
      success: true,
      timestamp: snapshot.timestamp,
      providers: snapshot.providers,
      timeframes: snapshot.timeframes,
      aggregateQuality: snapshot.aggregateQuality,
      normalizedQuality: snapshot.normalizedQuality,
      dataConfidence: snapshot.dataConfidence,
      providerOrder: snapshot.providerOrder,
      rateLimits: snapshot.rateLimits,
      defaultAvailability: snapshot.defaultAvailability,
      classification,
      latestBroadcast: latestProviderAvailabilitySnapshot,
      latestClassification,
      history,
      historyStats,
      historyLimit: providerAvailabilityHistoryLimit,
      historyStorage: {
        inMemorySamples: providerAvailabilityHistory.length,
        persistenceEnabled: Boolean(loadProviderAvailabilityHistory)
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to build provider availability snapshot');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metricsRegistry.register.contentType);
    res.send(await metricsRegistry.register.metrics());
  } catch (error) {
    logger.error({ err: error }, 'Failed to collect Prometheus metrics');
    res.status(500).json({
      success: false,
      error: 'Unable to collect metrics'
    });
  }
});

/**
 * Heartbeat status endpoint
 */
app.get('/api/health/heartbeat', (req, res) => {
  try {
    const heartbeat = heartbeatMonitor.getHeartbeat();
    res.json({
      success: true,
      heartbeat,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Heartbeat status retrieval failed');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Feature store summary
 */
app.get('/api/features', requireBasicRead, (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
    const stats = tradingEngine.featureStore?.getStats?.(limit) || {
      totalKeys: 0,
      totalEntries: 0,
      recent: []
    };
    const snapshotsLimit = req.query.snapshots ? parseInt(req.query.snapshots, 10) : 0;
    const recentSnapshots =
      snapshotsLimit > 0 ? tradingEngine.getFeatureSnapshots(snapshotsLimit) : undefined;
    res.json({
      success: true,
      stats,
      snapshots: recentSnapshots,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch feature summary');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Feature timeline for pair/timeframe
 */
app.get('/api/features/:pair', requireBasicRead, (req, res) => {
  try {
    const pair = (req.params.pair || '').toUpperCase();
    if (!pair) {
      return res.status(400).json({ success: false, error: 'Pair is required' });
    }

    const timeframe = (req.query.timeframe || 'M15').toUpperCase();
    const sinceTs = req.query.since ? Number(req.query.since) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const snapshotLimit = req.query.history ? parseInt(req.query.history, 10) : 0;
    const includeSnapshot = req.query.snapshot === 'true';

    const latest = tradingEngine.getLatestFeatures(pair, timeframe);
    const range = tradingEngine.getFeatureRange(pair, timeframe, { sinceTs, limit });
    const snapshot = includeSnapshot
      ? tradingEngine.getFeatureSnapshot(pair, {
          limitPerTimeframe: snapshotLimit || limit,
          sinceTs
        })
      : undefined;

    res.json({
      success: true,
      pair,
      timeframe,
      latest,
      range,
      snapshot,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error, pair: req.params?.pair }, 'Failed to fetch feature timeline');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/features-snapshots', requireBasicRead, (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const snapshots = tradingEngine.getFeatureSnapshots(limit);
    res.json({
      success: true,
      snapshots,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch feature snapshots');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get system status
 */
app.get('/api/status', requireBasicRead, (req, res) => {
  try {
    const status = tradeManager.getStatus();
    res.json({
      success: true,
      status,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch trading status');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate signal for a pair
 */
app.post('/api/signal/generate', requireSignalsGenerate, async (req, res) => {
  const { pair } = req.body || {};
  const startTime = process.hrtime.bigint();

  try {
    if (!pair) {
      return res.status(400).json({
        success: false,
        error: 'Pair is required'
      });
    }

    const signal = await tradingEngine.generateSignal(pair);
    const durationSeconds = durationSecondsFrom(startTime);
    observeSignalGeneration({ pair: signal?.pair || pair, durationSeconds, status: 'success' });

    broadcast('signal', signal);

    res.json({
      success: true,
      signal,
      timestamp: Date.now()
    });
  } catch (error) {
    const durationSeconds = durationSecondsFrom(startTime);
    observeSignalGeneration({ pair: pair || 'UNKNOWN', durationSeconds, status: 'error' });
    logger.error({ err: error, pair }, 'Failed to generate signal');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate signals for multiple pairs
 */
app.post('/api/signal/batch', requireSignalsGenerate, async (req, res) => {
  try {
    const { pairs } = req.body || {};

    if (!pairs || !Array.isArray(pairs)) {
      return res.status(400).json({
        success: false,
        error: 'Pairs array is required'
      });
    }

    const signals = await Promise.all(
      pairs.map(async (pair) => {
        const startTime = process.hrtime.bigint();
        try {
          const signal = await tradingEngine.generateSignal(pair);
          const durationSeconds = durationSecondsFrom(startTime);
          observeSignalGeneration({
            pair: signal?.pair || pair,
            durationSeconds,
            status: 'success'
          });
          return signal;
        } catch (error) {
          const durationSeconds = durationSecondsFrom(startTime);
          observeSignalGeneration({ pair: pair || 'UNKNOWN', durationSeconds, status: 'error' });
          logger.error({ err: error, pair }, 'Failed to generate batch signal');
          throw error;
        }
      })
    );

    res.json({
      success: true,
      count: signals.length,
      signals,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Batch signal generation failed');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Execute a trade
 */
app.post('/api/trade/execute', requireTradeExecute, async (req, res) => {
  const { pair } = req.body || {};

  if (!pair) {
    return res.status(400).json({
      success: false,
      error: 'Pair is required'
    });
  }

  const startTime = process.hrtime.bigint();
  let signalRecorded = false;

  try {
    // Generate signal
    const signal = await tradingEngine.generateSignal(pair);
    const signalDuration = durationSecondsFrom(startTime);
    observeSignalGeneration({
      pair: signal?.pair || pair,
      durationSeconds: signalDuration,
      status: 'success'
    });
    signalRecorded = true;

    // Execute trade
    const result = await tradingEngine.executeTrade(signal);
    recordTradeExecution(result.success ? 'success' : 'failed');

    if (result.success) {
      broadcast('trade_opened', result.trade);
    }

    void auditLogger.record('trade.execute', {
      actor: req.identity?.id || 'unknown',
      pair,
      success: Boolean(result.success)
    });

    res.json({
      success: result.success,
      trade: result.trade,
      reason: result.reason,
      signal: result.signal,
      timestamp: Date.now()
    });
  } catch (error) {
    if (!signalRecorded) {
      const failureDuration = durationSecondsFrom(startTime);
      observeSignalGeneration({ pair, durationSeconds: failureDuration, status: 'error' });
    }
    recordTradeExecution('error');
    logger.error({ err: error, pair }, 'Trade execution request failed');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get active trades
 */
app.get('/api/trades/active', requireTradeRead, (req, res) => {
  try {
    const trades = Array.from(tradingEngine.activeTrades.values());

    res.json({
      success: true,
      count: trades.length,
      trades,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch active trades');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get trade history
 */
app.get('/api/trades/history', requireTradeRead, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = tradingEngine.tradingHistory.slice(-limit);

    res.json({
      success: true,
      count: history.length,
      total: tradingEngine.tradingHistory.length,
      trades: history,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch trade history');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Close a specific trade
 */
app.post('/api/trade/close/:tradeId', requireTradeClose, async (req, res) => {
  try {
    const { tradeId } = req.params;
    const trade = tradingEngine.activeTrades.get(tradeId);

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: 'Trade not found'
      });
    }

    const currentPrice = await tradingEngine.getCurrentPriceForPair(trade.pair);
    const closed = await tradingEngine.closeTrade(tradeId, currentPrice, 'manual_close');

    broadcast('trade_closed', closed);

    void auditLogger.record('trade.close', {
      actor: req.identity?.id || 'unknown',
      tradeId,
      pair: trade.pair,
      success: true
    });

    res.json({
      success: true,
      trade: closed,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error, tradeId: req.params?.tradeId }, 'Failed to close trade');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Close all trades
 */
app.post('/api/trade/close-all', requireTradeClose, async (req, res) => {
  try {
    const result = await tradeManager.closeAllTrades();

    broadcast('all_trades_closed', result);

    void auditLogger.record('trade.close_all', {
      actor: req.identity?.id || 'unknown',
      closed: result.closed || 0
    });

    res.json({
      success: true,
      result,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to close all trades');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Start auto trading
 */
app.post('/api/auto-trading/start', requireAutomationControl, async (req, res) => {
  try {
    const result = await tradeManager.startAutoTrading();

    broadcast('auto_trading_started', result);

    void auditLogger.record('autotrading.start', {
      actor: req.identity?.id || 'unknown',
      success: Boolean(result.success)
    });

    res.json({
      success: result.success,
      message: result.message,
      details: result,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start auto trading');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop auto trading
 */
app.post('/api/auto-trading/stop', requireAutomationControl, (req, res) => {
  try {
    const result = tradeManager.stopAutoTrading();

    broadcast('auto_trading_stopped', result);

    void auditLogger.record('autotrading.stop', {
      actor: req.identity?.id || 'unknown',
      success: Boolean(result.success)
    });

    res.json({
      success: result.success,
      message: result.message,
      details: result,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to stop auto trading');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get trading statistics
 */
app.get('/api/statistics', requireBasicRead, (req, res) => {
  try {
    const stats = tradingEngine.getStatistics();

    res.json({
      success: true,
      statistics: stats,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch trading statistics');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get trading pairs
 */
app.get('/api/pairs', requireConfigRead, (req, res) => {
  try {
    res.json({
      success: true,
      pairs: tradeManager.tradingPairs,
      count: tradeManager.tradingPairs.length,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch trading pairs');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Add trading pair
 */
app.post('/api/pairs/add', requireConfigWrite, (req, res) => {
  try {
    const { pair } = req.body;

    if (!pair) {
      return res.status(400).json({
        success: false,
        error: 'Pair is required'
      });
    }

    const result = tradeManager.addPair(pair);

    void auditLogger.record('config.pair_add', {
      actor: req.identity?.id || 'unknown',
      pair,
      success: Boolean(result.success)
    });

    res.json({
      success: result.success,
      message: result.message,
      pairs: result.pairs,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error, pair: req.body?.pair }, 'Failed to add trading pair');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Remove trading pair
 */
app.post('/api/pairs/remove', requireConfigWrite, (req, res) => {
  try {
    const { pair } = req.body;

    if (!pair) {
      return res.status(400).json({
        success: false,
        error: 'Pair is required'
      });
    }

    const result = tradeManager.removePair(pair);

    void auditLogger.record('config.pair_remove', {
      actor: req.identity?.id || 'unknown',
      pair,
      success: Boolean(result.success)
    });

    res.json({
      success: result.success,
      message: result.message,
      pairs: result.pairs,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error, pair: req.body?.pair }, 'Failed to remove trading pair');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get configuration
 */
app.get('/api/config', requireConfigRead, (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        minSignalStrength: tradingEngine.config.minSignalStrength,
        riskPerTrade: tradingEngine.config.riskPerTrade,
        maxDailyRisk: tradingEngine.config.maxDailyRisk,
        maxConcurrentTrades: tradingEngine.config.maxConcurrentTrades,
        signalAmplifier: tradingEngine.config.signalAmplifier,
        directionThreshold: tradingEngine.config.directionThreshold
      },
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch configuration');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update configuration
 */
app.post('/api/config/update', requireConfigWrite, (req, res) => {
  try {
    const updates = req.body;

    Object.assign(tradingEngine.config, updates);

    void auditLogger.record('config.update', {
      actor: req.identity?.id || 'unknown',
      updates
    });

    res.json({
      success: true,
      message: 'Configuration updated',
      config: tradingEngine.config,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to update configuration');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error({ err }, 'Server error');
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
const PORT = serverConfig.port;

server.listen(PORT, () => {
  logger.info({ port: Number(PORT) }, 'Server listening');
  logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     Intelligent Auto-Trading System Started                  ║
║                                                               ║
║     Server: http://localhost:${PORT}                            ║
║                                                               ║
║     API Endpoints:                                           ║
║     - POST /api/signal/generate                              ║
║     - POST /api/signal/batch                                 ║
║     - POST /api/trade/execute                                ║
║     - POST /api/auto-trading/start                           ║
║     - POST /api/auto-trading/stop                            ║
║     - GET  /api/trades/active                                ║
║     - GET  /api/trades/history                               ║
║     - GET  /api/statistics                                   ║
║     - GET  /api/status                                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

server.on('close', () => {
  pairPrefetchScheduler.stop();
  riskReportService?.stop?.();
  brokerReconciliationService?.stop?.();
  if (websocketHeartbeat) {
    clearInterval(websocketHeartbeat);
  }
  if (providerAvailabilityInterval) {
    clearInterval(providerAvailabilityInterval);
  }
  for (const socket of websocketClients) {
    try {
      socket.terminate();
    } catch (error) {
      logger.warn({ err: error }, 'Failed to terminate WebSocket client');
    }
  }
  websocketClients.clear();
  wss?.close();
});

export { app, server, tradingEngine, tradeManager, brokerRouter };
