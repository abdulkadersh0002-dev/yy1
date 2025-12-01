import { Router } from 'express';
import {
  buildHealthzPayload,
  buildModuleHealthSummary,
  classifyProviderAvailabilitySnapshot,
  summarizeProviderAvailabilityHistory
} from '../src/services/health-summary.js';
import { ok, serverError } from '../src/utils/http-response.js';

export default function healthRoutes({
  tradingEngine,
  tradeManager,
  heartbeatMonitor,
  metricsRegistry,
  logger,
  providerAvailabilityState
}) {
  const router = Router();

  router.get('/healthz', (req, res) => {
    const payload = buildHealthzPayload({
      tradingEngine,
      tradeManager,
      heartbeatMonitor
    });

    const statusCode = payload.status === 'critical' ? 503 : 200;
    return ok(res, { data: payload }, { statusCode });
  });

  router.get('/health/modules', (req, res) => {
    const summary = buildModuleHealthSummary({
      tradingEngine,
      tradeManager,
      heartbeatMonitor
    });

    return ok(res, {
      overall: summary.overall,
      modules: summary.modules,
      heartbeat: summary.heartbeat
    });
  });

  router.get('/health/heartbeat', (req, res) => {
    try {
      const heartbeat = heartbeatMonitor.getHeartbeat();
      return ok(res, { heartbeat });
    } catch (error) {
      logger.error({ err: error }, 'Heartbeat status retrieval failed');
      return serverError(res, error);
    }
  });

  router.get('/health/providers', (req, res) => {
    const {
      buildSnapshot,
      providerAvailabilityAlertConfig,
      history,
      historyLimit,
      loadProviderAvailabilityHistory
    } = providerAvailabilityState;

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

      const snapshot = buildSnapshot({
        timeframes,
        requireHealthyQuality: req.query.requireHealthyQuality === 'false' ? false : true,
        qualityThreshold: Number.isFinite(qualityThresholdRaw) ? qualityThresholdRaw : undefined
      });

      const classification = classifyProviderAvailabilitySnapshot(
        snapshot,
        providerAvailabilityAlertConfig
      );
      const historyClone = history.map((entry) => ({
        ...entry,
        unavailableProviders: Array.isArray(entry.unavailableProviders)
          ? [...entry.unavailableProviders]
          : [],
        breakerProviders: Array.isArray(entry.breakerProviders) ? [...entry.breakerProviders] : [],
        blockedTimeframes: Array.isArray(entry.blockedTimeframes)
          ? [...entry.blockedTimeframes]
          : []
      }));
      const historyStats = summarizeProviderAvailabilityHistory(history);

      return ok(res, {
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
        history: historyClone,
        historyStats,
        historyLimit,
        historyStorage: {
          inMemorySamples: history.length,
          persistenceEnabled: Boolean(loadProviderAvailabilityHistory)
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to build provider availability snapshot');
      return serverError(res, error);
    }
  });

  router.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', metricsRegistry.register.contentType);
      res.send(await metricsRegistry.register.metrics());
    } catch (error) {
      logger.error({ err: error }, 'Failed to collect Prometheus metrics');
      return serverError(res, 'Unable to collect metrics');
    }
  });

  return router;
}
