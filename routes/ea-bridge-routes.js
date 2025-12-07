/**
 * EA Bridge Routes - Enhanced MT4/MT5 Expert Advisor Communication
 * Provides endpoints for intelligent trade execution and learning
 */

import { Router } from 'express';
import { badRequest, ok, serverError } from '../src/utils/http-response.js';

export default function eaBridgeRoutes({
  eaBridgeService,
  tradingEngine,
  brokerRouter,
  auditLogger,
  logger,
  requireBrokerWrite
}) {
  const router = Router();

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
        broker
      };

      const result = eaBridgeService.registerSession(payload);

      void auditLogger?.record('ea.session.connect', {
        broker,
        accountNumber: payload.accountNumber,
        accountMode: payload.accountMode
      });

      return ok(res, result);
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
        broker
      };

      const result = eaBridgeService.disconnectSession(payload);

      void auditLogger?.record('ea.session.disconnect', {
        broker,
        accountNumber: payload.accountNumber
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
        broker
      };

      const result = eaBridgeService.handleHeartbeat(payload);

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA heartbeat failed');
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
        broker
      };

      const result = await eaBridgeService.handleTransaction(payload);

      void auditLogger?.record('ea.transaction', {
        broker,
        type: payload.type,
        symbol: payload.symbol,
        profit: payload.profit
      });

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA transaction handling failed');
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
        accountMode: req.query.accountMode || req.body?.accountMode
      };

      if (!payload.symbol) {
        return badRequest(res, 'Symbol is required');
      }

      const result = await eaBridgeService.getSignalForExecution(payload);

      return ok(res, result);
    } catch (error) {
      logger.error({ err: error }, 'EA signal retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/statistics
   * Get EA bridge statistics and learning metrics
   */
  router.get('/broker/bridge/statistics', requireBrokerWrite, async (req, res) => {
    try {
      const stats = eaBridgeService.getStatistics();

      return ok(res, stats);
    } catch (error) {
      logger.error({ err: error }, 'EA statistics retrieval failed');
      return serverError(res, error);
    }
  });

  /**
   * GET /api/broker/bridge/sessions
   * Get active EA sessions
   */
  router.get('/broker/bridge/sessions', requireBrokerWrite, async (req, res) => {
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
