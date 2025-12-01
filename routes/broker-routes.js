import { Router } from 'express';
import { ok, serverError } from '../src/utils/http-response.js';

export default function brokerRoutes({
  tradingEngine,
  brokerRouter,
  auditLogger,
  logger,
  config,
  requireBrokerRead,
  requireBrokerWrite
}) {
  const router = Router();

  router.get('/broker/status', requireBrokerRead, async (req, res) => {
    if (!config.brokerRouting?.enabled) {
      return res.status(503).json({ success: false, error: 'Broker routing disabled' });
    }
    try {
      const status = brokerRouter.getStatus();
      const health = await brokerRouter.getHealthSnapshots();
      return ok(res, { status, health });
    } catch (error) {
      logger.error({ err: error }, 'Broker status retrieval failed');
      return serverError(res, error);
    }
  });

  router.post('/broker/kill-switch', requireBrokerWrite, (req, res) => {
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
      return ok(res, { state });
    } catch (error) {
      logger.error({ err: error }, 'Kill switch update failed');
      return serverError(res, error);
    }
  });

  router.post('/broker/manual-order', requireBrokerWrite, async (req, res) => {
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
      return ok(res, { result });
    } catch (error) {
      logger.error({ err: error }, 'Manual order failed');
      return serverError(res, error);
    }
  });

  router.post('/broker/manual-close', requireBrokerWrite, async (req, res) => {
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
      return ok(res, { result });
    } catch (error) {
      logger.error({ err: error }, 'Manual close failed');
      return serverError(res, error);
    }
  });

  return router;
}
