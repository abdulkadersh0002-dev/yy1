import { Router } from 'express';
import { ok, serverError } from '../src/utils/http-response.js';

export default function autoTradingRoutes({
  tradeManager,
  auditLogger,
  logger,
  broadcast,
  requireAutomationControl
}) {
  const router = Router();

  router.post('/auto-trading/start', requireAutomationControl, async (req, res) => {
    try {
      const result = await tradeManager.startAutoTrading();

      broadcast('auto_trading_started', result);

      void auditLogger.record('autotrading.start', {
        actor: req.identity?.id || 'unknown',
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
      const result = tradeManager.stopAutoTrading();

      broadcast('auto_trading_stopped', result);

      void auditLogger.record('autotrading.stop', {
        actor: req.identity?.id || 'unknown',
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
