/**
 * Enhanced EA Bridge Routes
 * Handles MT4/MT5 EA communication for price streaming and signal delivery
 */

import express from 'express';

const router = express.Router();

/**
 * Setup EA routes
 * @param {Object} dependencies - Service dependencies
 */
export function setupEARoutes(dependencies) {
  const { eaBridgeService, rssSignalGenerator, tradingEngine } = dependencies;

  /**
   * Register EA session
   */
  router.post('/register', async (req, res) => {
    try {
      const result = eaBridgeService.registerSession(req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * Disconnect EA session
   */
  router.post('/disconnect', async (req, res) => {
    try {
      const result = eaBridgeService.disconnectSession(req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * Handle price update from EA
   */
  router.post('/price-update', async (req, res) => {
    try {
      const { sessionId, prices } = req.body;

      if (!sessionId || !Array.isArray(prices)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid price data'
        });
      }

      // Update price cache in RSS signal generator
      if (rssSignalGenerator) {
        rssSignalGenerator.updatePrices(prices);
      }

      // Store in EA bridge service
      eaBridgeService.updatePriceCache(sessionId, prices);

      res.json({
        success: true,
        message: 'Prices updated',
        pricesReceived: prices.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * Get signals for EA
   */
  router.post('/get-signals', async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required'
        });
      }

      // Generate fresh signals from RSS
      let signals = [];
      if (rssSignalGenerator) {
        signals = await rssSignalGenerator.generateSignals({
          pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
          maxSignals: 3,
          minConfidence: 70
        });
      }

      // Get signals from trading engine if available
      if (tradingEngine && tradingEngine.getActiveSignals) {
        const engineSignals = tradingEngine.getActiveSignals();
        signals = [...signals, ...engineSignals];
      }

      // Return top signals
      const topSignals = signals
        .filter((s) => s.isValid && s.isValid.isValid)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 5);

      res.json({
        success: true,
        signals: topSignals,
        count: topSignals.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
        signals: []
      });
    }
  });

  /**
   * Handle heartbeat
   */
  router.post('/heartbeat', async (req, res) => {
    try {
      const { sessionId, equity, balance, openTrades } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required'
        });
      }

      // Update session info
      eaBridgeService.updateSession(sessionId, {
        equity,
        balance,
        openTrades,
        lastHeartbeat: Date.now()
      });

      res.json({
        success: true,
        message: 'Heartbeat received'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * Get EA sessions status
   */
  router.get('/sessions', async (req, res) => {
    try {
      const sessions = eaBridgeService.getActiveSessions();
      res.json({
        success: true,
        sessions,
        count: sessions.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * Get price cache status
   */
  router.get('/prices', async (req, res) => {
    try {
      const prices = Array.from((rssSignalGenerator?.priceCache || new Map()).entries()).map(
        ([pair, data]) => ({
          pair,
          ...data
        })
      );

      res.json({
        success: true,
        prices,
        count: prices.length,
        source: 'MT4/MT5 EA'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  return router;
}

export default setupEARoutes;
