import { Router } from 'express';
import { ok, badRequest, serverError, serviceUnavailable } from '../utils/http-response.js';

export default function featureRoutes({ tradingEngine, logger, requireBasicRead }) {
  const router = Router();

  router.get('/features', requireBasicRead, (req, res) => {
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
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
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
