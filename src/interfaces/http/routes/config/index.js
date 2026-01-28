import { Router } from 'express';
import { z } from 'zod';
import { ok, serverError } from '../../../../utils/http-response.js';
import { parseRequestBody } from '../../../../utils/validation.js';

export default function configRoutes({
  tradingEngine,
  tradeManager,
  auditLogger,
  logger,
  requireConfigRead,
  requireConfigWrite,
}) {
  const router = Router();

  const pairSchema = z.object({ pair: z.string().min(3).max(20) });
  const configUpdateSchema = z.object({
    minSignalStrength: z.number().int().min(1).max(100).optional(),
    riskPerTrade: z.number().positive().max(1).optional(),
    maxDailyRisk: z.number().positive().max(1).optional(),
    maxConcurrentTrades: z.number().int().min(1).max(100).optional(),
    signalAmplifier: z.number().positive().max(10).optional(),
    directionThreshold: z.number().int().min(1).max(100).optional(),
  });

  router.get('/pairs', requireConfigRead, (req, res) => {
    try {
      return ok(res, {
        pairs: tradeManager.tradingPairs,
        count: tradeManager.tradingPairs.length,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch trading pairs');
      return serverError(res, error);
    }
  });

  router.post('/pairs/add', requireConfigWrite, (req, res) => {
    try {
      const parsed = parseRequestBody(pairSchema, req, res, { errorMessage: 'Invalid pair' });
      if (!parsed) {
        return null;
      }

      const { pair } = parsed;

      const result = tradeManager.addPair(pair);

      void auditLogger.record('config.pair_add', {
        actor: req.identity?.id || 'unknown',
        pair,
        success: Boolean(result.success),
      });

      return ok(res, {
        message: result.message,
        pairs: result.pairs,
      });
    } catch (error) {
      logger.error({ err: error, pair: req.body?.pair }, 'Failed to add trading pair');
      return serverError(res, error);
    }
  });

  router.post('/pairs/remove', requireConfigWrite, (req, res) => {
    try {
      const parsed = parseRequestBody(pairSchema, req, res, { errorMessage: 'Invalid pair' });
      if (!parsed) {
        return null;
      }

      const { pair } = parsed;

      const result = tradeManager.removePair(pair);

      void auditLogger.record('config.pair_remove', {
        actor: req.identity?.id || 'unknown',
        pair,
        success: Boolean(result.success),
      });

      return ok(res, {
        message: result.message,
        pairs: result.pairs,
      });
    } catch (error) {
      logger.error({ err: error, pair: req.body?.pair }, 'Failed to remove trading pair');
      return serverError(res, error);
    }
  });

  router.get('/config', requireConfigRead, (req, res) => {
    try {
      return ok(res, {
        config: {
          minSignalStrength: tradingEngine.config.minSignalStrength,
          riskPerTrade: tradingEngine.config.riskPerTrade,
          maxDailyRisk: tradingEngine.config.maxDailyRisk,
          maxConcurrentTrades: tradingEngine.config.maxConcurrentTrades,
          signalAmplifier: tradingEngine.config.signalAmplifier,
          directionThreshold: tradingEngine.config.directionThreshold,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch configuration');
      return serverError(res, error);
    }
  });

  router.post('/config/update', requireConfigWrite, (req, res) => {
    try {
      const updates = parseRequestBody(configUpdateSchema, req, res, {
        errorMessage: 'Invalid configuration payload',
      });
      if (!updates) {
        return null;
      }

      Object.assign(tradingEngine.config, updates);

      void auditLogger.record('config.update', {
        actor: req.identity?.id || 'unknown',
        updates,
      });

      return ok(res, {
        message: 'Configuration updated',
        config: tradingEngine.config,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update configuration');
      return serverError(res, error);
    }
  });

  return router;
}
