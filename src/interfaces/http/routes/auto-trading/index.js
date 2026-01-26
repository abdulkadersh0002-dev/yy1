import { Router } from 'express';
import { ok, serverError } from '../../../utils/http-response.js';

export default function autoTradingRoutes({
  tradeManager,
  eaBridgeService,
  auditLogger,
  logger,
  broadcast,
  requireAutomationControl,
  requireBasicRead
}) {
  const router = Router();

  const forcedBroker = tradeManager?.normalizeBrokerId?.(process.env.AUTO_TRADING_FORCE_BROKER);

  // Read-only diagnostics for validating EA connectivity and auto-trading gating.
  // Useful to explain why an ENTER did/didn't execute without hunting logs.
  router.get(
    '/auto-trading/readiness',
    ...(Array.isArray(requireBasicRead)
      ? requireBasicRead
      : Array.isArray(requireAutomationControl)
        ? requireAutomationControl
        : []),
    async (req, res) => {
      try {
        const now = Date.now();
        const brokerRaw = req.query?.broker ?? null;
        const symbolRaw = req.query?.symbol ?? null;
        const maxAgeMs = req.query?.maxAgeMs != null ? Number(req.query.maxAgeMs) : 2 * 60 * 1000;

        const broker =
          tradeManager?.normalizeBrokerId?.(brokerRaw) ||
          tradeManager?.getDefaultBrokerId?.() ||
          'mt5';
        const symbolFromQuery = symbolRaw != null ? String(symbolRaw).trim().toUpperCase() : null;

        const isEaBroker = broker === 'mt4' || broker === 'mt5';

        let symbol = symbolFromQuery;
        let symbolSource = symbol ? 'query' : null;
        let observedSymbols = [];

        const autoTradingEnabled = Boolean(tradeManager?.isAutoTradingEnabled?.(broker));
        const connected = tradeManager?.isBrokerConnected
          ? await tradeManager.isBrokerConnected(broker)
          : false;

        let sessions = [];
        let quote = null;
        let quoteAgeMs = null;
        let bars = null;
        let execution = null;

        if (isEaBroker && eaBridgeService) {
          if (!symbol && typeof eaBridgeService.getQuotes === 'function') {
            try {
              const inferMaxAgeMs = Number.isFinite(maxAgeMs)
                ? Math.max(maxAgeMs, 5 * 60 * 1000)
                : 5 * 60 * 1000;
              const recentQuotes = eaBridgeService.getQuotes({
                broker,
                maxAgeMs: inferMaxAgeMs
              });
              if (Array.isArray(recentQuotes) && recentQuotes.length > 0) {
                observedSymbols = recentQuotes
                  .map((q) => q?.symbol)
                  .filter(Boolean)
                  .slice(0, 50);
                symbol = recentQuotes[0]?.symbol || null;
                if (symbol) {
                  symbolSource = 'latestQuote';
                }
              }
            } catch (_error) {
              // best-effort inference
            }
          }

          try {
            const allSessions =
              typeof eaBridgeService.getActiveSessions === 'function'
                ? eaBridgeService.getActiveSessions()
                : [];
            sessions = Array.isArray(allSessions)
              ? allSessions.filter((s) => String(s?.broker || '').toLowerCase() === broker)
              : [];
          } catch (_error) {
            sessions = [];
          }

          if (symbol && typeof eaBridgeService.getLatestQuoteForSymbolMatch === 'function') {
            try {
              quote = eaBridgeService.getLatestQuoteForSymbolMatch(broker, symbol);
              if (quote && quote.receivedAt) {
                quoteAgeMs = Math.max(0, now - Number(quote.receivedAt));
              }
            } catch (_error) {
              quote = null;
            }
          }

          if (symbol && typeof eaBridgeService.getMarketBars === 'function') {
            const getCount = (timeframe) => {
              try {
                const series = eaBridgeService.getMarketBars({
                  broker,
                  symbol,
                  timeframe,
                  limit: 120,
                  maxAgeMs: 0
                });
                return Array.isArray(series) ? series.length : 0;
              } catch (_error) {
                return 0;
              }
            };
            bars = {
              M1: getCount('M1'),
              M15: getCount('M15'),
              H1: getCount('H1')
            };
          }

          if (symbol && typeof eaBridgeService.getSignalForExecution === 'function') {
            try {
              const result = await eaBridgeService.getSignalForExecution({ broker, symbol });
              const signal = result?.signal || null;
              execution = {
                success: Boolean(result?.success),
                message: result?.message || null,
                snapshotPending: Boolean(result?.snapshotPending),
                shouldExecute: Boolean(result?.shouldExecute),
                execution: result?.execution || null,
                signalSummary: signal
                  ? {
                      pair: signal.pair || symbol,
                      broker: signal.broker ?? broker,
                      decisionState: signal?.isValid?.decision?.state || null,
                      decisionScore: signal?.isValid?.decision?.score ?? null,
                      direction: signal.direction || null,
                      confidence: signal.confidence ?? null,
                      strength: signal.strength ?? null,
                      valid: Boolean(signal?.isValid?.isValid),
                      validReason: signal?.isValid?.reason || null
                    }
                  : null
              };
            } catch (error) {
              execution = {
                success: false,
                message: error?.message || 'getSignalForExecution failed',
                snapshotPending: false,
                shouldExecute: false,
                execution: null,
                signalSummary: null
              };
            }
          }
        }

        const nextSteps = [];
        if (isEaBroker) {
          if (!symbol) {
            nextSteps.push('No symbol selected: pass ?symbol=EURUSD (or any Market Watch symbol)');
          }
          if (!autoTradingEnabled) {
            nextSteps.push('Auto-trading disabled: call POST /api/auto-trading/start');
          }
          if (!connected) {
            nextSteps.push(
              'EA not connected: verify BridgeUrl, ApiToken, and MT4/MT5 WebRequest whitelist for http://localhost:4101'
            );
          }
          if (connected && sessions.length === 0) {
            nextSteps.push(
              'EA is streaming quotes but no session/heartbeat is registered: ensure the EA is calling /session/connect and /agent/heartbeat (and that BridgeUrl/ApiToken match this backend)'
            );
          }
          if (symbol && !quote) {
            nextSteps.push(
              'No recent quote for symbol: ensure symbol is visible in Market Watch and EA is streaming quotes (MarketFeedIntervalSec)'
            );
          }
          if (symbol && quoteAgeMs != null && Number.isFinite(maxAgeMs) && quoteAgeMs > maxAgeMs) {
            nextSteps.push(
              `Quote is stale (${quoteAgeMs}ms): verify EA tick stream and check symbol is actively updating`
            );
          }
          if (symbol && bars && bars.M1 === 0 && bars.M15 === 0 && bars.H1 === 0) {
            nextSteps.push(
              'No cached bars: ensure EA is streaming candles or request candles endpoint once to warm cache'
            );
          }
          if (execution && execution.success === false && execution.message) {
            nextSteps.push(`Execution gate: ${execution.message}`);
          }
        }

        return ok(res, {
          success: true,
          now,
          maxAgeMs,
          broker,
          symbol,
          symbolSource,
          autoTradingEnabled,
          connected,
          thresholds: {
            realtimeMinConfidence: tradeManager?.realtimeMinConfidence ?? null,
            realtimeMinStrength: tradeManager?.realtimeMinStrength ?? null,
            realtimeRequireLayers18: tradeManager?.realtimeRequireLayers18 ?? null,
            smartStrong: tradeManager?.autoTradingSmartStrong ?? null,
            smartMinConfidence: tradeManager?.smartMinConfidence ?? null,
            smartMinStrength: tradeManager?.smartMinStrength ?? null,
            smartMinDecisionScore: tradeManager?.smartMinDecisionScore ?? null
          },
          sessions: {
            count: sessions.length,
            sessions
          },
          observedSymbols: observedSymbols.length > 0 ? observedSymbols : null,
          quote: quote
            ? {
                symbol: quote.symbol,
                receivedAt: quote.receivedAt,
                ageMs: quoteAgeMs,
                bid: quote.bid,
                ask: quote.ask,
                last: quote.last,
                mid: quote.mid,
                spreadPoints: quote.spreadPoints,
                source: quote.source
              }
            : null,
          bars,
          execution,
          nextSteps
        });
      } catch (error) {
        logger.error({ err: error }, 'Auto-trading readiness check failed');
        return serverError(res, error);
      }
    }
  );

  router.post('/auto-trading/start', requireAutomationControl, async (req, res) => {
    try {
      const brokerFromRequest = req?.body?.broker ?? null;
      const broker = forcedBroker || brokerFromRequest;
      const result = await tradeManager.startAutoTrading({ broker });

      broadcast('auto_trading_started', { ...result, broker: result?.broker ?? broker ?? null });

      void auditLogger.record('autotrading.start', {
        actor: req.identity?.id || 'unknown',
        broker: result?.broker ?? broker ?? null,
        success: Boolean(result.success)
      });

      return ok(res, {
        message: result.message,
        details: result
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to start auto trading');
      return serverError(res, error);
    }
  });

  router.post('/auto-trading/stop', requireAutomationControl, (req, res) => {
    try {
      const brokerFromRequest = req?.body?.broker ?? null;
      const broker = forcedBroker || brokerFromRequest;
      const result = tradeManager.stopAutoTrading({ broker });

      broadcast('auto_trading_stopped', { ...result, broker: result?.broker ?? broker ?? null });

      void auditLogger.record('autotrading.stop', {
        actor: req.identity?.id || 'unknown',
        broker: result?.broker ?? broker ?? null,
        success: Boolean(result.success)
      });

      return ok(res, {
        message: result.message,
        details: result
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to stop auto trading');
      return serverError(res, error);
    }
  });

  return router;
}
