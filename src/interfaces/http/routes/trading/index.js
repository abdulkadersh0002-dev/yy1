import { Router } from 'express';
import { z } from 'zod';
import { ok, badRequest, notFound, serverError } from '../../../utils/http-response.js';
import { parseRequestBody } from '../../../utils/validation.js';
import {
  createTradingSignalDTO,
  createTradeDTO,
  validateTradingSignalDTO,
  validateTradeDTO
} from '../../../../contracts/dtos.js';
import { eaOnlyMode } from '../../../config/runtime-flags.js';
import { attachLayeredAnalysisToSignal } from '../../../infrastructure/services/ea-signal-pipeline.js';
import { buildEaNotConnectedResponse } from '../../../utils/ea-bridge-diagnostics.js';

const durationSecondsFrom = (start) => Number(process.hrtime.bigint() - start) / 1e9;

export default function tradingRoutes({
  tradingEngine,
  tradeManager,
  eaBridgeService,
  auditLogger,
  logger,
  broadcast,
  requireBasicRead,
  requireSignalsGenerate,
  requireTradeExecute,
  requireTradeRead,
  requireTradeClose
}) {
  const router = Router();

  const pairSchema = z.object({
    pair: z.string().min(3).max(20),
    broker: z.string().min(2).max(20).optional(),
    eaOnly: z.boolean().optional(),
    analysisMode: z.string().min(1).max(20).optional(),
    broadcast: z.boolean().optional(),
    // Manual override for execution gates (news/session/liquidity/data-quality).
    // Defaults to false; meant for controlled operator interventions.
    force: z.boolean().optional()
  });
  const pairsSchema = z.object({
    pairs: z.array(z.string().min(3).max(20)).min(1),
    broker: z.string().min(2).max(20).optional(),
    eaOnly: z.boolean().optional(),
    analysisMode: z.string().min(1).max(20).optional()
  });

  router.get('/status', requireBasicRead, (req, res) => {
    try {
      const status = tradeManager.getStatus();
      return ok(res, { status });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch trading status');
      return serverError(res, error);
    }
  });

  router.get('/statistics', requireBasicRead, (req, res) => {
    try {
      const statistics = tradingEngine.getStatistics();
      const performance = tradingEngine.getPerformanceMetrics?.() || null;
      const breakdown = tradingEngine.getPerformanceBreakdown?.({ limit: 20 }) || null;
      return ok(res, { statistics, performance, breakdown });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch trading statistics');
      return serverError(res, error);
    }
  });

  router.post('/signal/generate', requireSignalsGenerate, async (req, res) => {
    const parsed = parseRequestBody(pairSchema, req, res, { errorMessage: 'Invalid pair' });
    if (!parsed) {
      return null;
    }
    const { pair, broker, eaOnly, analysisMode, broadcast: wantsBroadcast } = parsed;
    const startTime = process.hrtime.bigint();

    const forceEaOnly = eaOnlyMode(process.env);
    const normalizedBroker = broker ? String(broker).toLowerCase() : null;
    const brokerRequested = Boolean(normalizedBroker);
    const effectiveBroker = String(
      normalizedBroker || tradingEngine?.brokerRouter?.defaultBroker || 'mt5'
    ).toLowerCase();
    const brokerIsEa =
      (brokerRequested && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5')) ||
      (forceEaOnly && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5'));
    const wantsEaOnly =
      forceEaOnly ||
      eaOnly === true ||
      String(analysisMode || '').toLowerCase() === 'ea' ||
      brokerIsEa;

    try {
      if (!pair) {
        return badRequest(res, 'Pair is required');
      }

      const shouldRequireEaConnection = wantsEaOnly || Boolean(normalizedBroker && brokerIsEa);
      if (shouldRequireEaConnection && brokerIsEa) {
        const connected = eaBridgeService?.isBrokerConnected
          ? eaBridgeService.isBrokerConnected({ broker: effectiveBroker, maxAgeMs: 2 * 60 * 1000 })
          : false;
        if (!connected) {
          return res.status(409).json(
            buildEaNotConnectedResponse({
              broker: effectiveBroker,
              symbol: pair,
              eaBridgeService,
              maxAgeMs: 2 * 60 * 1000,
              now: Date.now()
            })
          );
        }
      }

      if (forceEaOnly && !brokerIsEa) {
        return badRequest(
          res,
          'EA-only mode is enabled. Use MT4/MT5 broker mode and connect the EA bridge first.'
        );
      }

      const options = wantsEaOnly
        ? { broker: effectiveBroker, eaOnly: true, analysisMode: 'ea' }
        : {
            ...(broker ? { broker } : null),
            ...(analysisMode ? { analysisMode } : null)
          };
      const signalRaw = await tradingEngine.generateSignal(pair, options);

      // Unify manual and EA-realtime explainability payload shape.
      // Best-effort: if EA data isn't available, layers will still be produced with a pending quote.
      attachLayeredAnalysisToSignal({
        rawSignal: signalRaw,
        broker: effectiveBroker,
        symbol: pair,
        eaBridgeService,
        quoteMaxAgeMs: 2 * 60 * 1000,
        now: Date.now()
      });

      const signal = validateTradingSignalDTO(createTradingSignalDTO(signalRaw));
      const durationSeconds = durationSecondsFrom(startTime);
      tradingEngine.observeSignalGeneration?.({
        pair: signal?.pair || pair,
        durationSeconds,
        status: 'success'
      });

      if (wantsBroadcast === true) {
        broadcast('signal', signal);
      }
      return ok(res, { signal });
    } catch (error) {
      const durationSeconds = durationSecondsFrom(startTime);
      tradingEngine.observeSignalGeneration?.({
        pair: pair || 'UNKNOWN',
        durationSeconds,
        status: 'error'
      });
      logger.error({ err: error, pair }, 'Failed to generate signal');
      return serverError(res, error);
    }
  });

  router.post('/signal/batch', requireSignalsGenerate, async (req, res) => {
    try {
      const parsed = parseRequestBody(pairsSchema, req, res, {
        errorMessage: 'Invalid pairs payload'
      });
      if (!parsed) {
        return null;
      }
      const { pairs, broker, eaOnly, analysisMode } = parsed;

      const forceEaOnly = eaOnlyMode(process.env);
      const normalizedBroker = broker ? String(broker).toLowerCase() : null;
      const brokerRequested = Boolean(normalizedBroker);
      const effectiveBroker = String(
        normalizedBroker || tradingEngine?.brokerRouter?.defaultBroker || 'mt5'
      ).toLowerCase();
      const brokerIsEa =
        (brokerRequested && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5')) ||
        (forceEaOnly && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5'));
      const wantsEaOnly =
        forceEaOnly ||
        eaOnly === true ||
        String(analysisMode || '').toLowerCase() === 'ea' ||
        brokerIsEa;

      const shouldRequireEaConnection = wantsEaOnly || Boolean(normalizedBroker && brokerIsEa);
      if (shouldRequireEaConnection && brokerIsEa) {
        const connected = eaBridgeService?.isBrokerConnected
          ? eaBridgeService.isBrokerConnected({ broker: effectiveBroker, maxAgeMs: 2 * 60 * 1000 })
          : false;
        if (!connected) {
          return res.status(409).json(
            buildEaNotConnectedResponse({
              broker: effectiveBroker,
              symbol: pairs?.[0] || null,
              eaBridgeService,
              maxAgeMs: 2 * 60 * 1000,
              now: Date.now()
            })
          );
        }
      }

      if (forceEaOnly && !brokerIsEa) {
        return badRequest(
          res,
          'EA-only mode is enabled. Use MT4/MT5 broker mode and connect the EA bridge first.'
        );
      }

      const options = wantsEaOnly
        ? { broker: effectiveBroker, eaOnly: true, analysisMode: 'ea' }
        : {
            ...(broker ? { broker } : null),
            ...(analysisMode ? { analysisMode } : null)
          };

      const signals = await Promise.all(
        pairs.map(async (pair) => {
          const startTime = process.hrtime.bigint();
          try {
            const signalRaw = await tradingEngine.generateSignal(pair, options);

            // Best-effort: attach layered explainability so batch results match /signal/generate.
            attachLayeredAnalysisToSignal({
              rawSignal: signalRaw,
              broker: effectiveBroker,
              symbol: pair,
              eaBridgeService,
              quoteMaxAgeMs: 2 * 60 * 1000,
              now: Date.now()
            });

            const signal = validateTradingSignalDTO(createTradingSignalDTO(signalRaw));
            const durationSeconds = durationSecondsFrom(startTime);
            tradingEngine.observeSignalGeneration?.({
              pair: signal?.pair || pair,
              durationSeconds,
              status: 'success'
            });
            return signal;
          } catch (error) {
            const durationSeconds = durationSecondsFrom(startTime);
            tradingEngine.observeSignalGeneration?.({
              pair: pair || 'UNKNOWN',
              durationSeconds,
              status: 'error'
            });
            logger.error({ err: error, pair }, 'Failed to generate batch signal');
            throw error;
          }
        })
      );

      return ok(res, { count: signals.length, signals });
    } catch (error) {
      logger.error({ err: error }, 'Batch signal generation failed');
      return serverError(res, error);
    }
  });

  router.post('/trade/execute', requireTradeExecute, async (req, res) => {
    const parsed = parseRequestBody(pairSchema, req, res, { errorMessage: 'Invalid pair' });
    if (!parsed) {
      return null;
    }
    const { pair, broker, force } = parsed;

    const forceEaOnly = eaOnlyMode(process.env);
    const normalizedBroker = broker ? String(broker).toLowerCase() : null;
    const brokerRequested = Boolean(normalizedBroker);
    const effectiveBroker = String(
      normalizedBroker || tradingEngine?.brokerRouter?.defaultBroker || 'mt5'
    ).toLowerCase();
    const brokerIsEa =
      (brokerRequested && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5')) ||
      (forceEaOnly && (effectiveBroker === 'mt4' || effectiveBroker === 'mt5'));

    const startTime = process.hrtime.bigint();
    let signalRecorded = false;

    try {
      if (forceEaOnly && !brokerIsEa) {
        return badRequest(
          res,
          'EA-only mode is enabled. Use MT4/MT5 broker mode and connect the EA bridge first.'
        );
      }

      if (brokerIsEa) {
        const connected = eaBridgeService?.isBrokerConnected
          ? eaBridgeService.isBrokerConnected({ broker: effectiveBroker, maxAgeMs: 2 * 60 * 1000 })
          : false;
        if (!connected) {
          return res.status(409).json(
            buildEaNotConnectedResponse({
              broker: effectiveBroker,
              symbol: pair,
              eaBridgeService,
              maxAgeMs: 2 * 60 * 1000,
              now: Date.now()
            })
          );
        }
      }

      let signalRaw = null;
      let execution = null;

      // Smarter behavior for MT4/MT5: use the EA bridge's server-authoritative execution decision.
      // This keeps manual /trade/execute from bypassing news/session/liquidity/data-quality gates.
      if (brokerIsEa && typeof eaBridgeService?.getSignalForExecution === 'function') {
        execution = await eaBridgeService.getSignalForExecution({
          broker: effectiveBroker,
          symbol: pair
        });

        if (!execution?.success) {
          return res.status(409).json({
            message: execution?.message || 'EA execution context not ready',
            broker: effectiveBroker,
            pair,
            shouldExecute: false,
            execution: execution?.execution || null
          });
        }

        signalRaw = execution?.signal || null;
        if (!signalRaw) {
          return res.status(409).json({
            message: execution?.message || 'No executable signal available',
            broker: effectiveBroker,
            pair,
            shouldExecute: false,
            execution: execution?.execution || null
          });
        }

        const blocked = execution?.shouldExecute === false;
        if (blocked && force !== true) {
          const dto = validateTradingSignalDTO(createTradingSignalDTO(signalRaw));
          return res.status(409).json({
            message: execution?.message || 'Execution blocked by policy',
            broker: effectiveBroker,
            pair,
            shouldExecute: false,
            execution: execution?.execution || null,
            signal: dto
          });
        }
      } else {
        signalRaw = brokerIsEa
          ? await tradingEngine.generateSignal(pair, {
              broker: effectiveBroker,
              eaOnly: true,
              analysisMode: 'ea'
            })
          : await tradingEngine.generateSignal(pair);
      }

      const signal = validateTradingSignalDTO(createTradingSignalDTO(signalRaw));
      const signalDuration = durationSecondsFrom(startTime);
      tradingEngine.observeSignalGeneration?.({
        pair: signal?.pair || pair,
        durationSeconds: signalDuration,
        status: 'success'
      });
      signalRecorded = true;

      const result = await tradingEngine.executeTrade(signal);
      tradingEngine.recordTradeExecution?.(result.success ? 'success' : 'failed');

      if (result.success) {
        broadcast('trade_opened', result.trade);
      }

      void auditLogger.record('trade.execute', {
        actor: req.identity?.id || 'unknown',
        pair,
        success: Boolean(result.success)
      });

      const trade = result.trade ? validateTradeDTO(createTradeDTO(result.trade)) : null;

      return ok(res, {
        trade,
        reason: result.reason,
        signal: result.signal
      });
    } catch (error) {
      if (!signalRecorded) {
        const failureDuration = durationSecondsFrom(startTime);
        tradingEngine.observeSignalGeneration?.({
          pair,
          durationSeconds: failureDuration,
          status: 'error'
        });
      }
      tradingEngine.recordTradeExecution?.('error');
      logger.error({ err: error, pair }, 'Trade execution request failed');
      return serverError(res, error);
    }
  });

  router.get('/trades/active', requireTradeRead, (req, res) => {
    try {
      const trades = Array.from(tradingEngine.activeTrades.values()).map((raw) =>
        validateTradeDTO(createTradeDTO(raw))
      );
      return ok(res, { count: trades.length, trades });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch active trades');
      return serverError(res, error);
    }
  });

  router.get('/trades/history', requireTradeRead, (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const history = tradingEngine.tradingHistory
        .slice(-limit)
        .map((raw) => validateTradeDTO(createTradeDTO(raw)));
      return ok(res, {
        count: history.length,
        total: tradingEngine.tradingHistory.length,
        trades: history
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch trade history');
      return serverError(res, error);
    }
  });

  router.post('/trade/close/:tradeId', requireTradeClose, async (req, res) => {
    try {
      const { tradeId } = req.params;
      const trade = tradingEngine.activeTrades.get(tradeId);

      if (!trade) {
        return notFound(res, 'Trade not found');
      }

      const currentPrice = await tradingEngine.getCurrentPriceForPair(trade.pair, {
        broker: trade.broker || trade.brokerRoute || null
      });
      const closedRaw = await tradingEngine.closeTrade(tradeId, currentPrice, 'manual_close');
      const closed = validateTradeDTO(createTradeDTO(closedRaw));

      broadcast('trade_closed', closed);

      void auditLogger.record('trade.close', {
        actor: req.identity?.id || 'unknown',
        tradeId,
        pair: trade.pair,
        success: true
      });

      return ok(res, { trade: closed });
    } catch (error) {
      logger.error({ err: error, tradeId: req.params?.tradeId }, 'Failed to close trade');
      return serverError(res, error);
    }
  });

  router.post('/trade/close-all', requireTradeClose, async (req, res) => {
    try {
      const result = await tradeManager.closeAllTrades();

      broadcast('all_trades_closed', result);

      void auditLogger.record('trade.close_all', {
        actor: req.identity?.id || 'unknown',
        closed: result.closed || 0
      });

      return ok(res, { result });
    } catch (error) {
      logger.error({ err: error }, 'Failed to close all trades');
      return serverError(res, error);
    }
  });

  return router;
}
