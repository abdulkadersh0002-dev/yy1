import { Router } from 'express';
import { z } from 'zod';
import {
  badRequest,
  notFound,
  ok,
  serverError,
  serviceUnavailable
} from '../../../utils/http-response.js';
import { validateModifyPositionDTO } from '../../../../contracts/dtos.js';
import { parseRequestBody, parseRequestBodyWithValidator } from '../../../utils/validation.js';

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

  const killSwitchSchema = z.object({
    enabled: z.coerce.boolean(),
    reason: z.string().max(300).optional()
  });

  router.get('/broker/status', requireBrokerRead, async (req, res) => {
    if (!config.brokerRouting?.enabled) {
      return serviceUnavailable(res, 'Broker routing disabled');
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
      return serviceUnavailable(res, 'Broker routing disabled');
    }
    try {
      const parsed = parseRequestBody(killSwitchSchema, req, res, {
        errorMessage: 'Invalid kill-switch payload'
      });
      if (!parsed) {
        return null;
      }
      const { enabled, reason } = parsed;
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
      return serviceUnavailable(res, 'Broker routing disabled');
    }
    try {
      const idempotencyKey =
        req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
      const payload = {
        ...req.body,
        ...(idempotencyKey ? { idempotencyKey } : null),
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
      return serviceUnavailable(res, 'Broker routing disabled');
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

  router.post('/broker/positions/modify', requireBrokerWrite, async (req, res) => {
    if (!config.brokerRouting?.enabled) {
      return serviceUnavailable(res, 'Broker routing disabled');
    }
    if (!config.tradingModifyApi?.enabled) {
      return serviceUnavailable(res, 'Trading modify API disabled');
    }

    try {
      const parsed = parseRequestBodyWithValidator(validateModifyPositionDTO, req, res, {
        errorMessage: 'Invalid modify payload'
      });
      if (!parsed) {
        return null;
      }

      const payload = {
        ...parsed,
        broker: parsed.broker || brokerRouter.defaultBroker,
        source: parsed.source || 'manual-override'
      };

      const result = await brokerRouter.modifyPosition(payload);
      void auditLogger.record('broker.modify_position', {
        actor: req.identity?.id || 'unknown',
        broker: payload.broker,
        ticket: String(payload.ticket),
        symbol: payload.symbol,
        stopLoss: payload.stopLoss ?? null,
        takeProfit: payload.takeProfit ?? null,
        reason: payload.reason || null,
        success: Boolean(result?.success)
      });

      return ok(res, { result });
    } catch (error) {
      logger.error({ err: error }, 'Position modify failed');
      return serverError(res, error);
    }
  });

  router.post('/broker/connectors/:id/probe', requireBrokerWrite, async (req, res) => {
    if (!config.brokerRouting?.enabled) {
      return serviceUnavailable(res, 'Broker routing disabled');
    }

    const connectorId = (req.params.id || '').toLowerCase();
    if (!connectorId) {
      return badRequest(res, 'Connector id is required');
    }

    try {
      const result = await brokerRouter.probeConnector(connectorId, {
        action: req.body?.action || 'connect',
        params: req.body?.params || {}
      });
      return ok(res, { connector: result });
    } catch (error) {
      if (error.code === 'UNKNOWN_CONNECTOR') {
        return notFound(res, error.message);
      }
      if (error.code === 'INVALID_CONNECTOR_ID') {
        return badRequest(res, error.message);
      }
      if (error.code === 'UNSUPPORTED_ACTION') {
        return badRequest(res, error.message);
      }

      // In local EA-only mode, MT4/MT5 terminals talk to /api/broker/bridge/*.
      // The optional connector microservices (ports 5001/5002) may not be running.
      // Don't hard-fail the dashboard with a 5xx in that case.
      if (
        (connectorId === 'mt4' || connectorId === 'mt5') &&
        error.code === 'CONNECTOR_ACTION_FAILED'
      ) {
        let health = {
          broker: connectorId,
          connected: false,
          error: error.message
        };

        try {
          const connector =
            typeof brokerRouter.getConnector === 'function'
              ? brokerRouter.getConnector(connectorId)
              : null;
          if (connector && typeof connector.healthCheck === 'function') {
            const snapshot = await connector.healthCheck();
            health = {
              ...snapshot,
              connected: Boolean(snapshot?.connected),
              error: snapshot?.error || health.error
            };
          }
        } catch (_ignored) {
          // Ignore health probe failures; we still respond with a safe payload.
        }

        return ok(res, {
          connector: {
            broker: connectorId,
            action: (req.body?.action || 'connect').toLowerCase(),
            health
          }
        });
      }

      logger.error({ err: error, connectorId }, 'Broker connector probe failed');
      const statusCode = error.code === 'CONNECTOR_ACTION_FAILED' ? 502 : undefined;
      return serverError(res, error, { statusCode });
    }
  });

  return router;
}
