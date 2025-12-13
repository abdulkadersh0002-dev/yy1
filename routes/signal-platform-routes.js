/**
 * Signal Platform API Routes
 * Complete API for #1 signal platform - delivery, analytics, history, monitoring
 */

import express from 'express';

export function createSignalPlatformRoutes({
  signalDeliveryService,
  signalAnalyticsService,
  masterOrchestrator,
  logger
}) {
  const router = express.Router();

  /**
   * GET /api/signals/live
   * Get current active signals
   */
  router.get('/live', async (req, res) => {
    try {
      const analytics = signalAnalyticsService.getRealTimeAnalytics();
      
      res.json({
        success: true,
        data: {
          activeSignals: analytics.activeSignals,
          count: analytics.activeCount,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get live signals');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve live signals'
      });
    }
  });

  /**
   * GET /api/signals/analytics
   * Get comprehensive analytics
   */
  router.get('/analytics', async (req, res) => {
    try {
      const analytics = signalAnalyticsService.getRealTimeAnalytics();
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get analytics');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve analytics'
      });
    }
  });

  /**
   * GET /api/signals/history
   * Get signal history with filters
   */
  router.get('/history', async (req, res) => {
    try {
      const filters = {
        pair: req.query.pair,
        outcome: req.query.outcome,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        minWinProbability: req.query.minWinProbability ? parseFloat(req.query.minWinProbability) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit) : 100,
        offset: req.query.offset ? parseInt(req.query.offset) : 0
      };

      const history = await signalAnalyticsService.getSignalHistory(filters);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get signal history');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve signal history'
      });
    }
  });

  /**
   * GET /api/signals/performance/by-pair
   * Get performance metrics by currency pair
   */
  router.get('/performance/by-pair', async (req, res) => {
    try {
      const performance = signalAnalyticsService.getPerformanceByPair();
      
      res.json({
        success: true,
        data: performance
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get performance by pair');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve performance data'
      });
    }
  });

  /**
   * GET /api/signals/quality-analysis
   * Get signal quality analysis
   */
  router.get('/quality-analysis', async (req, res) => {
    try {
      const analysis = signalAnalyticsService.getQualityAnalysis();
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get quality analysis');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve quality analysis'
      });
    }
  });

  /**
   * GET /api/signals/delivery-stats
   * Get signal delivery statistics
   */
  router.get('/delivery-stats', async (req, res) => {
    try {
      const stats = signalDeliveryService.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger?.error?.{ err: error }, 'Failed to get delivery stats');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve delivery statistics'
      });
    }
  });

  /**
   * POST /api/signals/:id/subscribe
   * Subscribe to signal notifications
   */
  router.post('/:id/subscribe', async (req, res) => {
    try {
      const { signalId } = req.params;
      const { channels } = req.body; // { email, telegram, webhook }

      // Validate channels
      if (!channels || typeof channels !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid channels configuration'
        });
      }

      // Store subscription (would typically persist to database)
      res.json({
        success: true,
        message: `Subscribed to signal ${signalId}`,
        channels
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to subscribe to signal');
      res.status(500).json({
        success: false,
        error: 'Failed to subscribe'
      });
    }
  });

  /**
   * GET /api/platform/status
   * Get complete platform status
   */
  router.get('/platform/status', async (req, res) => {
    try {
      const status = await masterOrchestrator?.getStatus?.() || {
        status: 'unknown',
        message: 'Master orchestrator not available'
      };

      const analytics = signalAnalyticsService.getRealTimeAnalytics();
      const deliveryStats = signalDeliveryService.getStats();

      res.json({
        success: true,
        data: {
          platform: status,
          signals: {
            active: analytics.activeCount,
            performance: analytics.performance
          },
          delivery: deliveryStats,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to get platform status');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve platform status'
      });
    }
  });

  /**
   * GET /api/platform/health
   * Health check endpoint for monitoring
   */
  router.get('/platform/health', (req, res) => {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  return router;
}
