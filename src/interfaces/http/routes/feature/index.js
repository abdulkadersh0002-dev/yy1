import { Router } from 'express';
import { z } from 'zod';
import { ok, badRequest, serverError, serviceUnavailable } from '../../../utils/http-response.js';
import { parseRequestQuery } from '../../../utils/validation.js';

export default function featureRoutes({ tradingEngine, logger, requireBasicRead }) {
  const router = Router();

  const featuresQuerySchema = z
    .object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      snapshots: z.coerce.number().int().min(0).max(500).optional()
    })
    .passthrough();

  const featuresByPairQuerySchema = z
    .object({
      timeframe: z.string().min(1).max(10).optional(),
      since: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      history: z.coerce.number().int().min(0).max(500).optional(),
      snapshot: z.string().optional()
    })
    .passthrough();

  const snapshotsQuerySchema = z
    .object({
      limit: z.coerce.number().int().min(1).max(1000).optional()
    })
    .passthrough();

  router.get('/features', requireBasicRead, (req, res) => {
    try {
      const parsed = parseRequestQuery(featuresQuerySchema, req, res, {
        errorMessage: 'Invalid feature query'
      });
      if (!parsed) {
        return null;
      }

      const limit = parsed.limit ?? 25;
      const stats = tradingEngine.featureStore?.getStats?.(limit) || {
        totalKeys: 0,
        totalEntries: 0,
        recent: []
      };
      const snapshotsLimit = parsed.snapshots ?? 0;
      const recentSnapshots =
        snapshotsLimit > 0 ? tradingEngine.getFeatureSnapshots(snapshotsLimit) : undefined;
      return ok(res, { stats, snapshots: recentSnapshots });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch feature summary');
      return serverError(res, error);
    }
  });

  router.get('/features/:pair', requireBasicRead, (req, res) => {
    try {
      const pair = (req.params.pair || '').toUpperCase();
      if (!pair) {
        return badRequest(res, 'Pair is required');
      }

      const parsed = parseRequestQuery(featuresByPairQuerySchema, req, res, {
        errorMessage: 'Invalid feature query'
      });
      if (!parsed) {
        return null;
      }

      const timeframe = (parsed.timeframe || 'M15').toUpperCase();
      const sinceTs = parsed.since ?? undefined;
      const limit = parsed.limit ?? 50;
      const snapshotLimit = parsed.history ?? 0;
      const includeSnapshot = parsed.snapshot === 'true';

      const latest = tradingEngine.getLatestFeatures(pair, timeframe);
      const range = tradingEngine.getFeatureRange(pair, timeframe, { sinceTs, limit });
      const snapshot = includeSnapshot
        ? tradingEngine.getFeatureSnapshot(pair, {
            limitPerTimeframe: snapshotLimit || limit,
            sinceTs
          })
        : undefined;

      return ok(res, {
        pair,
        timeframe,
        latest,
        range,
        snapshot
      });
    } catch (error) {
      logger.error({ err: error, pair: req.params?.pair }, 'Failed to fetch feature timeline');
      return serverError(res, error);
    }
  });

  router.get('/features-snapshots', requireBasicRead, (req, res) => {
    try {
      const parsed = parseRequestQuery(snapshotsQuerySchema, req, res, {
        errorMessage: 'Invalid feature snapshot query'
      });
      if (!parsed) {
        return null;
      }

      const limit = parsed.limit ?? 100;
      const snapshots = tradingEngine.getFeatureSnapshots(limit);
      return ok(res, { snapshots });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch feature snapshots');
      return serverError(res, error);
    }
  });

  router.get('/risk/command-center', (req, res) => {
    const config = tradingEngine.config || {};
    if (config.riskCommandCenter?.enabled === false) {
      return serviceUnavailable(res, 'Risk command center disabled');
    }
    try {
      const snapshot = tradingEngine.getRiskCommandSnapshot?.();
      return ok(res, { snapshot });
    } catch (error) {
      logger.error({ err: error }, 'Failed to build risk command center snapshot');
      return serverError(res, error);
    }
  });

  return router;
}
