/**
 * EA Bridge Routes - Enhanced MT4/MT5 Expert Advisor Communication
 * Provides endpoints for intelligent trade execution and safety
 */

import { Router } from 'express';
import { badRequest, ok, serverError } from '../../../../utils/http-response.js';
import { RealtimeEaSignalRunner } from '../../../../infrastructure/services/realtime-ea-signal-runner.js';
import {
  validateMarketBarsIngestDTO,
  validateMarketQuotesIngestDTO,
  validateMarketSnapshotIngestDTO,
  validateMarketNewsIngestDTO,
} from '../../../../contracts/dtos.js';
import { buildEaConnectionDiagnostics } from '../../../../utils/ea-bridge-diagnostics.js';
import { parseRequestBodyWithValidator } from '../../../../utils/validation.js';
import { isSaneEaSymbolToken } from '../../../../utils/ea-symbols.js';
import { readEnvBool, readEnvNumber } from '../../../../utils/env.js';
import {
  resolveLiquidityGuardThresholds,
  resolveNewsGuardThresholds,
} from '../../../../core/policy/trading-policy.js';

export default function eaBridgeRoutes({
  eaBridgeService,
  tradingEngine: _tradingEngine,
  brokerRouter: _brokerRouter,
  tradeManager,
  auditLogger,
  logger,
  broadcast,
  requireBrokerWrite,
}) {
  const router = Router();

  const buildServerPolicy = (broker) => {
    const engineConfig = _tradingEngine?.config || {};
    const autoTradingConfig = engineConfig.autoTrading || {};

    const envMinConfidence = readEnvNumber('EA_SIGNAL_MIN_CONFIDENCE', null);
    const envMinStrength = readEnvNumber('EA_SIGNAL_MIN_STRENGTH', null);

    const minConfidence =
      tradeManager?.realtimeMinConfidence ??
      (Number.isFinite(envMinConfidence) ? envMinConfidence : 45);
    const minStrength =
      tradeManager?.realtimeMinStrength ?? (Number.isFinite(envMinStrength) ? envMinStrength : 35);
    const requireLayers18 = tradeManager?.realtimeRequireLayers18 ?? true;

    const allowWaitMonitorExecution = readEnvBool('EA_SIGNAL_ALLOW_WAIT_MONITOR', false) === true;

    const dynamicTrailingEnabled = readEnvBool('EA_DYNAMIC_TRAILING_ENABLED', false) === true;
    const partialCloseEnabled = readEnvBool('EA_PARTIAL_CLOSE_ENABLED', false) === true;
    const sessionStrictEnabled = readEnvBool('EA_SESSION_STRICT', false) === true;

    const { impactThreshold: resolvedNewsImpact, blackoutMinutes: resolvedNewsMinutes } =
      resolveNewsGuardThresholds(engineConfig);
    const { maxSpreadPips: resolvedMaxSpreadPips } = resolveLiquidityGuardThresholds(engineConfig);

    const brokerStatus = _brokerRouter?.getStatus ? _brokerRouter.getStatus() : null;

    return {
      broker: broker ? String(broker).trim().toLowerCase() : null,
      authority: {
        // Smarter default: server is authoritative for *decisioning* and EA can optionally
        // execute orders locally only when server returns shouldExecute=true.
        decision: 'server',
        execution: 'ea',
        management: 'hybrid',
      },
      gates: {
        newsBlackoutMinutes: resolvedNewsMinutes,
        newsBlackoutImpactThreshold: resolvedNewsImpact,
        enforceTradingWindows: Boolean(engineConfig.enforceTradingWindows),
        tradingWindowsLondon: Array.isArray(engineConfig.tradingWindowsLondon)
          ? engineConfig.tradingWindowsLondon
          : null,
        enforceSpreadToAtrHard: Boolean(engineConfig.enforceSpreadToAtrHard),
        maxSpreadToAtrHard: Number.isFinite(Number(engineConfig.maxSpreadToAtrHard))
          ? Number(engineConfig.maxSpreadToAtrHard)
          : null,
        maxSpreadToTpHard: Number.isFinite(Number(engineConfig.maxSpreadToTpHard))
          ? Number(engineConfig.maxSpreadToTpHard)
          : null,
        requireBarsCoverage: Boolean(engineConfig.requireBarsCoverage),
        barsMinM15: Number.isFinite(Number(engineConfig.barsMinM15))
          ? Number(engineConfig.barsMinM15)
          : null,
        barsMinH1: Number.isFinite(Number(engineConfig.barsMinH1))
          ? Number(engineConfig.barsMinH1)
          : null,
        barsMaxAgeM15Ms: Number.isFinite(Number(engineConfig.barsMaxAgeM15Ms))
          ? Number(engineConfig.barsMaxAgeM15Ms)
          : null,
        barsMaxAgeH1Ms: Number.isFinite(Number(engineConfig.barsMaxAgeH1Ms))
          ? Number(engineConfig.barsMaxAgeH1Ms)
          : null,
        requireHtfDirection: Boolean(engineConfig.requireHtfDirection),
      },
      brokerStatus: {
        killSwitchEnabled: Boolean(brokerStatus?.killSwitchEnabled),
        killSwitchReason: brokerStatus?.killSwitchReason || null,
        defaultBroker: brokerStatus?.defaultBroker || null,
      },
      execution: {
        // Current server behavior: only execute ENTER signals.
        requiresEnterState: true,
        minConfidence,
        minStrength,
        requireLayers18,
        allowWaitMonitorExecution,
        assetClasses: tradeManager?.autoTradingAssetClasses
          ? Array.from(tradeManager.autoTradingAssetClasses)
          : null,
      },
      tradeManagement: {
        dynamicTrailingEnabled,
        partialCloseEnabled,
        sessionStrict: sessionStrictEnabled,
        newsGuard: {
          impactThreshold: resolvedNewsImpact,
          blackoutMinutes: resolvedNewsMinutes,
        },
        liquidityGuard: {
          maxSpreadPips: resolvedMaxSpreadPips,
        },
      },
      runtime: {
        requireRealtimeData: readEnvBool('REQUIRE_REALTIME_DATA', false) === true,
        allowSyntheticData: readEnvBool('ALLOW_SYNTHETIC_DATA', false) === true,
        allowAllSymbols: readEnvBool('ALLOW_ALL_SYMBOLS', false) === true,
      },
      autoTrading: {
        enabled: tradeManager?.isAutoTradingEnabled
          ? tradeManager.isAutoTradingEnabled(broker)
          : null,
        realtimeSignalExecutionEnabled:
          autoTradingConfig?.realtimeSignalExecutionEnabled != null
            ? Boolean(autoTradingConfig.realtimeSignalExecutionEnabled)
            : null,
        maxNewTradesPerCycle: Number.isFinite(Number(autoTradingConfig.maxNewTradesPerCycle))
          ? Number(autoTradingConfig.maxNewTradesPerCycle)
          : null,
      },
    };
  };

  const isBackgroundSignalsEnabled = () => {
    // Explicit opt-in/out always wins.
    const explicit = readEnvBool('EA_BACKGROUND_SIGNALS', null);
    if (explicit != null) {
      return explicit === true;
    }

    // In EA-only mode, the dashboard expects the server to continuously scan and
    // publish WATCH/ENTER signals from the real-time EA feed.
    return readEnvBool('EA_ONLY_MODE', true) === true;
  };

  const isStrictEaSymbolFilterEnabled = () => {
    return readEnvBool('EA_STRICT_SYMBOL_FILTER', false) === true;
  };

  const isScanAllowAllSymbolsEnabled = () => {
    const raw = readEnvBool('EA_SCAN_ALLOW_ALL_SYMBOLS', null);
    // If the app is running in "allow all" / full-scan mode, scan should follow suit.
    // This keeps analysis running for everything streamed by the EA without requiring
    // dashboard interaction (tape/search).
    if (readEnvBool('ALLOW_ALL_SYMBOLS', false) === true) {
      return true;
    }
    if (eaBridgeService?.fullScanEnabled === true) {
      return true;
    }
    return raw === true;
  };

  const isAllowedEaSymbol = (symbol) => {
    const s = String(symbol || '')
      .trim()
      .toUpperCase();
    if (!s) {
      return false;
    }

    // Always require basic sanity.
    if (!isSaneEaSymbolToken(s)) {
      return false;
    }

    // For ingestion endpoints we preserve the legacy behavior:
    // - if strict filtering is OFF, accept any sane symbol token.
    // - if strict filtering is ON, use EA bridge asset filters.
    if (!isStrictEaSymbolFilterEnabled()) {
      return true;
    }

    try {
      return eaBridgeService?.isAllowedAssetSymbol ? eaBridgeService.isAllowedAssetSymbol(s) : true;
    } catch (_error) {
      return true;
    }
  };

  // Background scan / realtime-signal generation should default to FX/metals/crypto only
  // unless explicitly overridden. However, we also allow scanning symbols that are already
  // streaming from the EA for the given broker (dashboard-driven visibility).
  const isAllowedScanSymbol = (broker, symbol) => {
    const s = String(symbol || '')
      .trim()
      .toUpperCase();
    if (!s) {
      return false;
    }
    if (!isAllowedEaSymbol(s)) {
      return false;
    }
    if (isScanAllowAllSymbolsEnabled()) {
      return true;
    }

    // If the symbol is already present in the EA stream for this broker, allow scan.
    // This keeps the dashboard working for equities/indices without requiring ALLOW_ALL_SYMBOLS.
    try {
      const brokerId = String(broker || '')
        .trim()
        .toLowerCase();
      if (brokerId) {
        const existing = eaBridgeService?.getLatestQuoteForSymbolMatch
          ? eaBridgeService.getLatestQuoteForSymbolMatch(brokerId, s)
          : null;
        if (existing) {
          return true;
        }
      }
    } catch (_error) {
      // fall through
    }

    try {
      if (typeof eaBridgeService?.isSupportedAssetSymbol === 'function') {
        return eaBridgeService.isSupportedAssetSymbol(s);
      }
    } catch (_error) {
      // fall through
    }
    return true;
  };

  const realtimeSignalRunner = (() => {
    const runner = new RealtimeEaSignalRunner({
      tradingEngine: _tradingEngine,
      eaBridgeService,
      broadcast,
      onSignal: ({ broker, signal }) => {
        try {
          tradeManager?.enqueueRealtimeSignal?.({ broker, signal });
        } catch (_error) {
          // best-effort
        }
      },
      logger,
    });

    // Only start continuous loops when explicitly enabled.
    if (!isBackgroundSignalsEnabled()) {
      return runner;
    }

    // "Living signals": periodically re-run validation for previously published symbols
    // so downgrades/expirations are visible even if no new bars arrive.
    try {
      runner.startRevalidationLoop();
    } catch (_error) {
      // best-effort
    }

    // Background scan: continuously evaluate all recently seen symbols for strong signals.
    // Disabled by default; enable with EA_BACKGROUND_SIGNALS=true.
    try {
      const envInterval = Number(process.env.EA_SCAN_INTERVAL_MS);
      const scanIntervalMs = Number.isFinite(envInterval) ? Math.max(2000, envInterval) : 15 * 1000;

      const envBatch = Number(process.env.EA_SCAN_BATCH_SIZE);
      const scanBatchSize = Number.isFinite(envBatch) ? Math.max(10, Math.trunc(envBatch)) : 180;

      const scanCursorByBroker = new Map(); // broker -> index

      const timer = setInterval(() => {
        try {
          const brokers = ['mt4', 'mt5'];
          for (const broker of brokers) {
            const allSymbols = (() => {
              // Prefer an explicit symbol listing when available (includes bars/snapshots),
              // so scanning keeps working even if quotes pause temporarily.
              if (typeof eaBridgeService?.listKnownSymbols === 'function') {
                const maxAgeMs = Number(process.env.EA_SCAN_SYMBOL_MAX_AGE_MS);
                const envMaxSymbols = Number(process.env.EA_SCAN_SYMBOLS_MAX);
                const fullScanPreferredMax = eaBridgeService?.fullScanEnabled ? 2000 : null;
                const maxSymbols = Number.isFinite(envMaxSymbols)
                  ? Math.max(10, Math.trunc(envMaxSymbols))
                  : fullScanPreferredMax != null
                    ? fullScanPreferredMax
                    : scanBatchSize * 8;
                const symbols = eaBridgeService.listKnownSymbols({
                  broker,
                  maxAgeMs: Number.isFinite(maxAgeMs) ? Math.max(0, maxAgeMs) : 30 * 60 * 1000,
                  max: maxSymbols,
                });
                return (Array.isArray(symbols) ? symbols : [])
                  .map((s) =>
                    String(s || '')
                      .trim()
                      .toUpperCase()
                  )
                  .filter(Boolean)
                  .filter((s) => isAllowedScanSymbol(broker, s));
              }

              const quotes = eaBridgeService?.getQuotes
                ? eaBridgeService.getQuotes({
                    broker,
                    maxAgeMs: 5 * 60 * 1000,
                    orderBy: 'symbol',
                  })
                : [];
              return (Array.isArray(quotes) ? quotes : [])
                .map((q) =>
                  String(q?.symbol || q?.pair || '')
                    .trim()
                    .toUpperCase()
                )
                .filter(Boolean)
                .filter((s) => isAllowedScanSymbol(broker, s));
            })();

            const total = allSymbols.length;
            if (total <= 0) {
              continue;
            }

            const cursor = scanCursorByBroker.get(broker) || 0;
            const batchSize = Math.min(scanBatchSize, total);
            const batch = [];
            for (let i = 0; i < batchSize; i += 1) {
              batch.push(allSymbols[(cursor + i) % total]);
            }

            scanCursorByBroker.set(broker, (cursor + batchSize) % Math.max(1, total));

            if (batch.length > 0) {
              runner.ingestSymbols({ broker, symbols: batch });
            }
          }
        } catch (_error) {
          // best-effort
        }
      }, scanIntervalMs);
      timer.unref?.();
    } catch (_error) {
      // best-effort
    }

    return runner;
  })();

  const extractSymbolsFromQuotesPayload = (payload) => {
    const symbols = new Set();
    const rawQuotes = Array.isArray(payload?.quotes) ? payload.quotes : null;
    if (rawQuotes) {
      for (const q of rawQuotes) {
        const s = String(q?.symbol || q?.pair || '')
          .trim()
          .toUpperCase();
        if (s) {
          symbols.add(s);
        }
      }
    } else {
      const s = String(payload?.symbol || payload?.pair || '')
        .trim()
        .toUpperCase();
      if (s) {
        symbols.add(s);
      }
    }
    return Array.from(symbols);
  };

  const asMiddlewareList = (value) => {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value.filter(Boolean) : [value];
  };

  const brokerWriteMiddleware = asMiddlewareList(requireBrokerWrite);

  const createBufferedBroadcaster = ({ type, flushMs = 200 } = {}) => {
    let timer = null;
    const bufferByBroker = new Map();

    const flush = () => {
      timer = null;
      if (typeof broadcast !== 'function') {
        bufferByBroker.clear();
        return;
      }

      for (const [broker, items] of bufferByBroker.entries()) {
        if (!items || items.length === 0) {
          continue;
        }
        try {
          broadcast(type, { broker, items });
        } catch (error) {
          logger?.warn?.({ err: error, type }, 'WebSocket broadcast failed');
        }
      }
      bufferByBroker.clear();
    };

    const enqueue = (broker, items) => {
      if (!broker) {
        return;
      }
      const list = bufferByBroker.get(broker) || [];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item) {
            list.push(item);
          }
        }
      } else if (items) {
        list.push(items);
      }
      bufferByBroker.set(broker, list);

      if (!timer) {
        timer = setTimeout(flush, flushMs);
        timer.unref?.();
      }
    };

    return { enqueue };
  };

  const quotesBroadcaster = createBufferedBroadcaster({ type: 'ea.market.quotes', flushMs: 250 });
  const barsBroadcaster = createBufferedBroadcaster({ type: 'ea.market.bars', flushMs: 350 });

  /**
   * POST /api/broker/bridge/mt4/session/connect
   * POST /api/broker/bridge/mt5/session/connect
   * Register EA session
   */
  router.post('/broker/bridge/:broker/session/connect', async (req, res) => {
    try {
      const broker = req.params.broker; // mt4 or mt5
      const payload = {
        ...req.body,
        broker,
      };

      const result = eaBridgeService.registerSession(payload);

      void auditLogger?.record('ea.session.connect', {
        broker,
        accountNumber: payload.accountNumber,
        accountMode: payload.accountMode,
      });

      return ok(res, { ...result, serverPolicy: buildServerPolicy(broker) });
    } catch (error) {
      logger.error({ err: error }, 'EA session connect failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/session/disconnect
   * Disconnect EA session
   */
  router.post('/broker/bridge/:broker/session/disconnect', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        ...req.body,
        broker,
      };

      const result = eaBridgeService.disconnectSession(payload);

      void auditLogger?.record('ea.session.disconnect', {
        broker,
        accountNumber: payload.accountNumber,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA session disconnect failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/agent/heartbeat
   * Handle EA heartbeat
   */
  router.post('/broker/bridge/:broker/agent/heartbeat', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        ...req.body,
        broker,
      };

      const result = eaBridgeService.handleHeartbeat(payload);

      return ok(res, { ...result, serverPolicy: buildServerPolicy(broker) });
    } catch (error) {
      logger.error({ err: error }, 'EA heartbeat failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/agent/manage
   * Returns trade management actions for open positions (partial closes, trailing, SL moves).
   */
  router.post('/broker/bridge/:broker/agent/manage', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        ...req.body,
        broker,
      };
      const result = eaBridgeService.evaluatePositionManagement(payload);

      const enqueueEnv = String(process.env.EA_MANAGEMENT_ENQUEUE || '')
        .trim()
        .toLowerCase();
      const enqueue =
        payload.enqueue === true ||
        enqueueEnv === '1' ||
        enqueueEnv === 'true' ||
        enqueueEnv === 'yes';

      if (enqueue && Array.isArray(result?.commands)) {
        eaBridgeService.enqueueManagementCommands({ broker, commands: result.commands });
      }

      return ok(res, { ...result, serverPolicy: buildServerPolicy(broker), enqueued: enqueue });
    } catch (error) {
      logger.error({ err: error }, 'EA manage request failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/agent/commands
   * EA polls for pending trade management commands.
   */
  router.get('/broker/bridge/:broker/agent/commands', async (req, res) => {
    try {
      const broker = req.params.broker;
      const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 20;
      const result = eaBridgeService.drainManagementCommands({ broker, limit });
      return ok(res, { ...result, serverPolicy: buildServerPolicy(broker) });
    } catch (error) {
      logger.error({ err: error }, 'EA commands poll failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/agent/config
   * Returns current server execution policy for EA alignment and troubleshooting.
   */
  router.get('/broker/bridge/:broker/agent/config', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const broker = req.params.broker;
      const policy = buildServerPolicy(broker);

      // Include the most recent active session for this broker (if any), so
      // operators can see the EA-reported settings.
      const sessions = eaBridgeService.getActiveSessions?.() || [];
      const session = sessions.find((s) => s?.broker === broker) || null;

      return ok(res, {
        broker,
        serverPolicy: policy,
        session: session
          ? {
              id: session.id,
              accountNumber: session.accountNumber,
              accountMode: session.accountMode,
              server: session.server,
              currency: session.currency,
              equity: session.equity,
              balance: session.balance,
              lastHeartbeat: session.lastHeartbeat,
              ea: session.ea || null,
            }
          : null,
      });
    } catch (error) {
      logger.error({ err: error }, 'EA agent config retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/agent/transaction
   * Handle trade transaction from EA
   */
  router.post('/broker/bridge/:broker/agent/transaction', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        ...req.body,
        broker,
      };

      const result = await eaBridgeService.handleTransaction(payload);

      void auditLogger?.record('ea.transaction', {
        broker,
        type: payload.type,
        symbol: payload.symbol,
        profit: payload.profit,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA transaction handling failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/quotes
   * EA posts streaming quotes (single or batch)
   */
  router.post('/broker/bridge/:broker/market/quotes', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = parseRequestBodyWithValidator(validateMarketQuotesIngestDTO, req, res, {
        errorMessage: 'Invalid quotes payload',
        payload: { ...(req.body || {}), broker },
      });
      if (!payload) {
        return null;
      }

      const result = eaBridgeService.recordQuotes(payload);

      try {
        const rawQuotes = Array.isArray(payload?.quotes)
          ? payload.quotes
          : payload && (payload.symbol || payload.pair)
            ? [payload]
            : [];

        const wsQuotes = rawQuotes
          .map((quote) => {
            const symbol = String(quote?.symbol || quote?.pair || '')
              .trim()
              .toUpperCase();
            if (!symbol || !isAllowedEaSymbol(symbol)) {
              return null;
            }
            return {
              symbol,
              bid: quote?.bid ?? null,
              ask: quote?.ask ?? null,
              last: quote?.last ?? null,
              digits: quote?.digits ?? null,
              point: quote?.point ?? null,
              spreadPoints: quote?.spreadPoints ?? null,
              timestamp: quote?.timestamp ?? quote?.time ?? null,
            };
          })
          .filter(Boolean);

        if (wsQuotes.length > 0) {
          quotesBroadcaster.enqueue(broker, wsQuotes);
        }
      } catch (_error) {
        // best-effort
      }

      // Fire-and-forget: generate strong realtime signals based on EA quotes + snapshots.
      const symbols = extractSymbolsFromQuotesPayload(payload);
      const scanSymbols = symbols.filter((s) => isAllowedScanSymbol(broker, s));
      if (scanSymbols.length > 0) {
        realtimeSignalRunner?.ingestSymbols?.({ broker, symbols: scanSymbols });
      }

      void auditLogger?.record('ea.market.quotes', {
        broker,
        recorded: result?.recorded ?? null,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA market quotes ingestion failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/symbols
   * EA registers its full symbol universe (MarketWatch), enabling true "all symbols" scan.
   *
   * Body: { symbols: ["EURUSD", "XAUUSD", ...] }
   */
  router.post('/broker/bridge/:broker/market/symbols', async (req, res) => {
    try {
      const broker = req.params.broker;
      const symbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols
        : Array.isArray(req.body)
          ? req.body
          : [];

      const result = eaBridgeService?.recordSymbols
        ? eaBridgeService.recordSymbols({ broker, symbols })
        : { success: false, message: 'Symbol registry not supported' };

      void auditLogger?.record('ea.market.symbols.register', {
        broker,
        recorded: result?.recorded ?? null,
        count: result?.count ?? null,
      });

      return ok(res, { ...result, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA market symbols registration failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/market/symbols
   * Dashboard reads the EA-registered symbol list (requires auth)
   */
  router.get(
    '/broker/bridge/:broker/market/symbols',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const max = req.query.max;
        const symbols = eaBridgeService?.getRegisteredSymbols
          ? eaBridgeService.getRegisteredSymbols({ broker, max })
          : [];
        return ok(res, { broker, symbols, count: symbols.length, timestamp: Date.now() });
      } catch (error) {
        logger.error({ err: error }, 'EA market symbols retrieval failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * GET /api/broker/bridge/:broker/market/quotes
   * Dashboard reads latest quotes (requires auth)
   */
  router.get('/broker/bridge/:broker/market/quotes', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const broker = req.params.broker;
      const symbols = typeof req.query.symbols === 'string' ? req.query.symbols.split(',') : null;
      const quotes = eaBridgeService.getQuotes({
        broker,
        symbols,
        maxAgeMs: req.query.maxAgeMs,
        orderBy: req.query.orderBy,
      });
      return ok(res, { broker, quotes, count: quotes.length, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA market quotes retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/news
   * EA posts news/events/expectations from terminal indicators
   */
  router.post('/broker/bridge/:broker/market/news', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = parseRequestBodyWithValidator(validateMarketNewsIngestDTO, req, res, {
        errorMessage: 'Invalid news payload',
        payload: { ...(req.body || {}), broker },
      });
      if (!payload) {
        return null;
      }

      const result = eaBridgeService.recordNews(payload);

      void auditLogger?.record('ea.market.news', {
        broker,
        ingested: result?.ingested ?? null,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA market news ingestion failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/snapshot
   * EA posts computed technical snapshot (RSI/MACD/ATR + pivots/ranges)
   */
  router.post('/broker/bridge/:broker/market/snapshot', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = parseRequestBodyWithValidator(validateMarketSnapshotIngestDTO, req, res, {
        errorMessage: 'Invalid snapshot payload',
        payload: { ...(req.body || {}), broker },
      });
      if (!payload) {
        return null;
      }

      const result = eaBridgeService.recordMarketSnapshot(payload);

      try {
        const symbol = String(payload.symbol || payload.pair || '')
          .trim()
          .toUpperCase();
        if (symbol && isAllowedEaSymbol(symbol) && typeof broadcast === 'function') {
          broadcast('ea.market.snapshot', {
            broker,
            symbol,
            timestamp: payload.timestamp || payload.time || null,
            timeframes: payload.timeframes || null,
          });
        }
      } catch (_error) {
        // best-effort
      }

      // Snapshot arrival usually means we can compute a richer signal immediately.
      const symbol = String(payload.symbol || payload.pair || '')
        .trim()
        .toUpperCase();
      if (symbol) {
        if (isAllowedScanSymbol(broker, symbol)) {
          realtimeSignalRunner?.ingestSymbols?.({ broker, symbols: [symbol] });
        }
      }

      void auditLogger?.record('ea.market.snapshot', {
        broker,
        symbol: payload.symbol || payload.pair || null,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA market snapshot ingestion failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/snapshot/request
   * Dashboard requests an on-demand snapshot for a symbol.
   */
  router.post(
    '/broker/bridge/:broker/market/snapshot/request',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const symbol =
          req.body?.symbol || req.body?.pair || req.query.symbol || req.query.pair || null;
        if (!symbol) {
          return badRequest(res, { message: 'symbol is required' });
        }

        const result = eaBridgeService.requestMarketSnapshot({
          broker,
          symbol,
          ttlMs: req.body?.ttlMs,
        });

        void auditLogger?.record('ea.market.snapshot.request', {
          broker,
          symbol,
        });

        return ok(res, result);
      } catch (error) {
        logger.error({ err: error }, 'EA market snapshot request failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * GET /api/broker/bridge/:broker/market/snapshot/requests
   * EA polls for pending on-demand snapshot requests.
   */
  router.get('/broker/bridge/:broker/market/snapshot/requests', async (req, res) => {
    try {
      const broker = req.params.broker;
      const max = req.query.max;
      const symbols = eaBridgeService.consumeMarketSnapshotRequests({ broker, max });
      return ok(res, { broker, symbols, count: symbols.length, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA market snapshot request polling failed');
      return serverError(res, error);
    }
  });

  /**
   * POST /api/broker/bridge/:broker/market/active-symbols
   * Dashboard tells the server which symbols are currently selected/visible.
   */
  router.post(
    '/broker/bridge/:broker/market/active-symbols',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const symbols = Array.isArray(req.body?.symbols)
          ? req.body.symbols
          : Array.isArray(req.body)
            ? req.body
            : [];

        const result = eaBridgeService.setActiveSymbols({
          broker,
          symbols,
          ttlMs: req.body?.ttlMs,
        });

        // Best-effort: when the dashboard changes the tape, proactively run analysis.
        try {
          const syms = Array.isArray(result?.symbols) ? result.symbols : [];
          if (syms.length > 0) {
            const scanSyms = syms.filter((s) => isAllowedScanSymbol(broker, s));
            if (scanSyms.length > 0) {
              realtimeSignalRunner?.ingestSymbols?.({ broker, symbols: scanSyms });
            }
          }
        } catch (_error) {
          // best-effort
        }

        void auditLogger?.record('ea.market.active_symbols.set', {
          broker,
          count: Array.isArray(result?.symbols) ? result.symbols.length : null,
        });

        return ok(res, { ...result, timestamp: Date.now() });
      } catch (error) {
        logger.error({ err: error }, 'EA active symbols update failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * GET /api/broker/bridge/:broker/market/active-symbols
   * EA polls active symbols to reduce load (lazy loading).
   */
  router.get('/broker/bridge/:broker/market/active-symbols', async (req, res) => {
    try {
      const broker = req.params.broker;
      const max = req.query.max;
      const symbols = eaBridgeService.getActiveSymbols({ broker, max });
      return ok(res, { broker, symbols, count: symbols.length, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA active symbols retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/market/snapshot
   * Dashboard reads latest EA-provided snapshot (requires auth)
   */
  router.get(
    '/broker/bridge/:broker/market/snapshot',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const symbol = req.query.symbol || req.query.pair || null;
        const snapshot = eaBridgeService.getMarketSnapshot({
          broker,
          symbol,
          maxAgeMs: req.query.maxAgeMs,
        });
        return ok(res, { broker, symbol: symbol || null, snapshot, timestamp: Date.now() });
      } catch (error) {
        logger.error({ err: error }, 'EA market snapshot retrieval failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * POST /api/broker/bridge/:broker/market/bars
   * EA posts bar updates (rolling candle history) for a symbol/timeframe.
   */
  router.post('/broker/bridge/:broker/market/bars', async (req, res) => {
    try {
      const broker = req.params.broker;
      const candidate = {
        ...(req.body || {}),
        broker,
      };

      const payload = parseRequestBodyWithValidator(validateMarketBarsIngestDTO, req, res, {
        errorMessage: 'Invalid bars payload',
        payload: candidate,
      });
      if (!payload) {
        return null;
      }

      const result = eaBridgeService.recordMarketBars(payload);

      try {
        const symbol = String(payload.symbol || payload.pair || '')
          .trim()
          .toUpperCase();
        if (symbol && isAllowedEaSymbol(symbol)) {
          barsBroadcaster.enqueue(broker, {
            symbol,
            timeframe: payload.timeframe || payload.tf || null,
            timestamp: payload.timestamp || payload.time || null,
            bar: payload.bar || null,
            bars: Array.isArray(payload.bars) ? payload.bars : null,
          });

          // Compute-on-close behavior: only trigger realtime analysis on higher timeframes.
          // (M1 bars are often intra-candle updates for UI; avoid spamming the engine.)
          const timeframe = String(payload.timeframe || payload.tf || '')
            .trim()
            .toUpperCase();
          const triggerTimeframes = new Set(['M15', 'H1', 'H4', 'D1']);
          if (triggerTimeframes.has(timeframe)) {
            const seededBarsCount = Array.isArray(payload.bars) ? payload.bars.length : 0;
            const isClosed = Boolean(payload.closed);
            // Trigger on bar-close OR when a sizeable history batch arrives (startup seeding).
            if (
              (payload.bar && typeof payload.bar === 'object' && isClosed) ||
              seededBarsCount >= 50
            ) {
              if (isAllowedScanSymbol(broker, symbol)) {
                realtimeSignalRunner?.ingestSymbols?.({ broker, symbols: [symbol] });
              }
            }
          }
        }
      } catch (_error) {
        // best-effort
      }

      void auditLogger?.record('ea.market.bars', {
        broker,
        symbol: payload.symbol || null,
        timeframe: payload.timeframe || null,
        recorded: result?.recorded ?? null,
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA market bars ingestion failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/market/bars
   * Dashboard reads last bars for a symbol/timeframe (requires auth)
   */
  router.get('/broker/bridge/:broker/market/bars', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const broker = req.params.broker;
      const symbol = req.query.symbol || req.query.pair || null;
      const timeframe = req.query.timeframe || req.query.tf || null;
      if (!symbol || !timeframe) {
        return badRequest(res, { message: 'symbol and timeframe are required' });
      }

      const bars = eaBridgeService.getMarketBars({
        broker,
        symbol,
        timeframe,
        limit: req.query.limit,
        maxAgeMs: req.query.maxAgeMs,
      });

      return ok(res, {
        broker,
        symbol,
        timeframe,
        bars,
        count: bars.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error({ err: error }, 'EA market bars retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/market/candles
   * Dashboard reads candles for charting.
   * Prefer EA-provided bars; fallback to quote-derived candles for free realtime display.
   */
  router.get(
    '/broker/bridge/:broker/market/candles',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const symbol = req.query.symbol || req.query.pair || null;
        const timeframe = req.query.timeframe || req.query.tf || null;
        if (!symbol || !timeframe) {
          return badRequest(res, { message: 'symbol and timeframe are required' });
        }

        // Hint the EA/bridge to keep this symbol hot.
        try {
          eaBridgeService.touchActiveSymbol({
            broker,
            symbol,
            ttlMs: req.query.ttlMs,
          });
        } catch (_error) {
          // best-effort
        }

        const candles = eaBridgeService.getMarketCandles({
          broker,
          symbol,
          timeframe,
          limit: req.query.limit,
          maxAgeMs: req.query.maxAgeMs,
        });

        return ok(res, {
          broker,
          symbol,
          timeframe,
          candles,
          count: candles.length,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error({ err: error }, 'EA market candles retrieval failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * GET /api/broker/bridge/:broker/market/candle-analysis
   * Returns lightweight, cached candle analysis per timeframe.
   */
  router.get(
    '/broker/bridge/:broker/market/candle-analysis',
    ...brokerWriteMiddleware,
    async (req, res) => {
      try {
        const broker = req.params.broker;
        const symbol = req.query.symbol || req.query.pair || null;
        const timeframes = req.query.timeframes || req.query.tf || 'M15,H1,H4,D1';
        if (!symbol) {
          return badRequest(res, { message: 'symbol is required' });
        }

        // Hint the EA/bridge to keep this symbol hot.
        try {
          eaBridgeService.touchActiveSymbol({
            broker,
            symbol,
            ttlMs: req.query.ttlMs,
          });
        } catch (_error) {
          // best-effort
        }

        const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 200;
        const maxAgeMs = Number.isFinite(Number(req.query.maxAgeMs))
          ? Number(req.query.maxAgeMs)
          : 0;

        const result = eaBridgeService.getMarketCandleAnalysisByTimeframe({
          broker,
          symbol,
          timeframes,
          limit,
          maxAgeMs,
        });

        return ok(res, {
          broker,
          symbol,
          timeframes,
          limit,
          maxAgeMs,
          analyses: result.analyses,
          aggregate: result.aggregate,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error({ err: error }, 'EA market candle analysis retrieval failed');
        return serverError(res, error);
      }
    }
  );

  /**
   * GET /api/broker/bridge/:broker/market/news
   * Dashboard reads EA-provided news/events (requires auth)
   */
  router.get('/broker/bridge/:broker/market/news', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const broker = req.params.broker;
      const news = eaBridgeService.getNews({ broker, limit: req.query.limit });
      return ok(res, { broker, news, count: news.length, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA market news retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/signal/get
   * Get trading signal for EA execution
   */
  router.get('/broker/bridge/:broker/signal/get', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        symbol: req.query.symbol || req.body?.symbol,
        broker,
        accountMode: req.query.accountMode || req.body?.accountMode,
      };

      if (!payload.symbol) {
        return badRequest(res, 'Symbol is required');
      }

      const result = await eaBridgeService.getSignalForExecution(payload);

      // Avoid ok() here because ok() always forces success=true; the EA relies on success.
      return res.status(200).json({ ...result, broker, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA signal retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/:broker/analysis/get
   * Dashboard analysis snapshot (returns signal even if not trade-valid)
   */
  router.get('/broker/bridge/:broker/analysis/get', async (req, res) => {
    try {
      const broker = req.params.broker;
      const payload = {
        symbol: req.query.symbol || req.body?.symbol,
        broker,
        accountMode: req.query.accountMode || req.body?.accountMode,
      };

      if (!payload.symbol) {
        return badRequest(res, 'Symbol is required');
      }

      const result = await eaBridgeService.getAnalysisSnapshot(payload);

      const requestedTimeframe =
        typeof req.query.timeframe === 'string' && req.query.timeframe.trim()
          ? req.query.timeframe.trim()
          : 'M1';

      const timeframesParam =
        typeof req.query.timeframes === 'string' && req.query.timeframes.trim()
          ? req.query.timeframes
          : null;
      const requestedTimeframes = timeframesParam
        ? timeframesParam
            .split(',')
            .map((t) =>
              String(t || '')
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
            .slice(0, 8)
        : [String(requestedTimeframe).trim().toUpperCase()];

      let barsContext = null;
      let barsContextByTimeframe = null;
      try {
        const maxAgeMsRaw = Number(req.query.barsMaxAgeMs);

        const maxAgeMs =
          Number.isFinite(maxAgeMsRaw) && maxAgeMsRaw > 0 ? maxAgeMsRaw : 2 * 60 * 1000;

        barsContextByTimeframe = {};
        for (const tf of requestedTimeframes) {
          const bars = eaBridgeService.getMarketBars({
            broker,
            symbol: payload.symbol,
            timeframe: tf,
            limit: 1,
            maxAgeMs,
          });
          const latestBar = Array.isArray(bars) && bars.length ? bars[0] : null;
          barsContextByTimeframe[tf] = { symbol: payload.symbol, timeframe: tf, bar: latestBar };
        }

        const keyTf = String(requestedTimeframe).trim().toUpperCase();
        const primary = barsContextByTimeframe[keyTf] || null;
        barsContext = primary || {
          symbol: payload.symbol,
          timeframe: requestedTimeframe,
          bar: null,
        };
      } catch (error) {
        barsContext = {
          symbol: payload.symbol,
          timeframe: requestedTimeframe,
          bar: null,
          error: error?.message || 'bars unavailable',
        };

        if (requestedTimeframes.length > 1) {
          barsContextByTimeframe = { error: error?.message || 'bars unavailable' };
        }
      }

      return res
        .status(200)
        .json({ ...result, barsContext, barsContextByTimeframe, broker, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error }, 'EA analysis retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/statistics
   * Get EA bridge statistics and learning metrics
   */
  router.get('/broker/bridge/statistics', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const stats = eaBridgeService.getStatistics();

      return ok(res, stats);
    } catch (error) {
      logger.error({ err: error }, 'EA statistics retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/status
   * Convenience endpoint that returns derived connection diagnostics.
   * Useful when the EA streams quotes before registering sessions.
   */
  router.get('/broker/bridge/status', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const broker = req.query?.broker ? String(req.query.broker).trim().toLowerCase() : null;
      const symbol = req.query?.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
      const maxAgeMs = req.query?.maxAgeMs != null ? Number(req.query.maxAgeMs) : 2 * 60 * 1000;
      const now = Date.now();

      if (broker) {
        const diagnostics = buildEaConnectionDiagnostics({
          eaBridgeService,
          broker,
          symbol,
          maxAgeMs,
          now,
        });
        return ok(res, { now, maxAgeMs: diagnostics.maxAgeMs, ...diagnostics });
      }

      const brokers = ['mt4', 'mt5'];
      const byBroker = {};
      for (const b of brokers) {
        byBroker[b] = buildEaConnectionDiagnostics({
          eaBridgeService,
          broker: b,
          symbol,
          maxAgeMs,
          now,
        });
      }

      return ok(res, { now, maxAgeMs, brokers: byBroker });
    } catch (error) {
      logger.error({ err: error }, 'EA status retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/sessions
   * Get active EA sessions
   */
  router.get('/broker/bridge/sessions', ...brokerWriteMiddleware, async (req, res) => {
    try {
      const sessions = eaBridgeService.getActiveSessions();

      return ok(res, { sessions, count: sessions.length });
    } catch (error) {
      logger.error({ err: error }, 'EA sessions retrieval failed');
      return serverError(res, error);
    }
  });

  return router;
}
