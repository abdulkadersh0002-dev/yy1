/**
 * Auto-Trader API Routes
 * 
 * REST API endpoints for controlling and monitoring the intelligent auto-trader
 */

import express from 'express';
import logger from '../config/logger.js';

const router = express.Router();

// This will be injected by the application
let autoTrader = null;

export function setAutoTrader(trader) {
  autoTrader = trader;
}

/**
 * GET /api/auto-trader/status
 * Get auto-trader status and active trades
 */
router.get('/status', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    const status = autoTrader.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error getting status: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auto-trader/enable
 * Enable auto-trading
 */
router.post('/enable', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    autoTrader.setEnabled(true);
    
    res.json({
      success: true,
      message: 'Auto-trading enabled'
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error enabling: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auto-trader/disable
 * Disable auto-trading (keeps existing trades)
 */
router.post('/disable', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    autoTrader.setEnabled(false);
    
    res.json({
      success: true,
      message: 'Auto-trading disabled'
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error disabling: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auto-trader/close-all
 * Close all active trades (emergency stop)
 */
router.post('/close-all', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    const { reason } = req.body;
    await autoTrader.closeAllTrades(reason || 'Manual close all via API');
    
    res.json({
      success: true,
      message: 'All trades closed'
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error closing all trades: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auto-trader/process-signal
 * Manually submit a signal for auto-trading
 */
router.post('/process-signal', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    const signal = req.body;
    const result = await autoTrader.processSignal(signal);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error processing signal: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auto-trader/config
 * Get current auto-trader configuration
 */
router.get('/config', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    res.json({
      success: true,
      data: autoTrader.config
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error getting config: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/auto-trader/config
 * Update auto-trader configuration
 */
router.put('/config', async (req, res) => {
  try {
    if (!autoTrader) {
      return res.status(503).json({
        success: false,
        error: 'Auto-trader not initialized'
      });
    }

    const updates = req.body;
    
    // Update config (only allow certain fields)
    const allowedUpdates = [
      'minSignalScore',
      'breakEvenPips',
      'partialClosePips',
      'partialClosePercent',
      'maxSimultaneousTrades',
      'maxDailyTrades',
      'avoidHighImpactNews',
      'newsBufferMinutes'
    ];

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        autoTrader.config[key] = updates[key];
      }
    }
    
    res.json({
      success: true,
      message: 'Configuration updated',
      data: autoTrader.config
    });
  } catch (error) {
    logger.error(`[AutoTraderAPI] Error updating config: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
