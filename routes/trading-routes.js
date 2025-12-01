import { Router } from 'express';
import { z } from 'zod';
import { ok, badRequest, notFound, serverError } from '../src/utils/http-response.js';
import {
  createTradingSignalDTO,
  createTradeDTO,
  validateTradingSignalDTO,
  validateTradeDTO
} from '../src/models/dtos.js';

const durationSecondsFrom = (start) => Number(process.hrtime.bigint() - start) / 1e9;

export default function tradingRoutes({
  tradingEngine,
  tradeManager,
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

  const pairSchema = z.object({ pair: z.string().min(3).max(20) });
  const pairsSchema = z.object({ pairs: z.array(z.string().min(3).max(20)).min(1) });

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
      return ok(res, { statistics });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch trading statistics');
      return serverError(res, error);
    }
  });

  router.post('/signal/generate', requireSignalsGenerate, async (req, res) => {
    const parseResult = pairSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return badRequest(res, 'Invalid pair');
    }
    const { pair } = parseResult.data;
    const startTime = process.hrtime.bigint();

    try {
      if (!pair) {
        return badRequest(res, 'Pair is required');
      }

      const signalRaw = await tradingEngine.generateSignal(pair);
      const signal = validateTradingSignalDTO(createTradingSignalDTO(signalRaw));
      const durationSeconds = durationSecondsFrom(startTime);
      tradingEngine.observeSignalGeneration?.({
        pair: signal?.pair || pair,
        durationSeconds,
        status: 'success'
      });

      broadcast('signal', signal);
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
      const parseResult = pairsSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        return badRequest(res, 'Invalid pairs payload');
      }
      const { pairs } = parseResult.data;

      const signals = await Promise.all(
        pairs.map(async (pair) => {
          const startTime = process.hrtime.bigint();
          try {
            const signalRaw = await tradingEngine.generateSignal(pair);
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
    const parseResult = pairSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return badRequest(res, 'Invalid pair');
    }
    const { pair } = parseResult.data;

    const startTime = process.hrtime.bigint();
    let signalRecorded = false;

    try {
      const signalRaw = await tradingEngine.generateSignal(pair);
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

      const currentPrice = await tradingEngine.getCurrentPriceForPair(trade.pair);
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
