/**
 * Metrics Collector
 * Collects and tracks all platform metrics for observability
 */

import logger from '../services/logging/logger.js';

class MetricsCollector {
  constructor() {
    this.metrics = {
      // Trading metrics
      trades: {
        total: 0,
        wins: 0,
        losses: 0,
        winStreak: 0,
        lossStreak: 0,
        currentStreak: 0,
        maxWinStreak: 0,
        maxLossStreak: 0,
        rejectedTrades: 0
      },

      // Data source latency (ms)
      latency: {
        EA_PRICE: [],
        RSS_NEWS: [],
        TWELVE_DATA: [],
        WEBSOCKET: [],
        DATABASE: []
      },

      // Rejection reasons
      rejections: {
        RISK_LIMIT: 0,
        COOLDOWN: 0,
        DAILY_LOSS: 0,
        WEEKLY_LOSS: 0,
        CONSECUTIVE_LOSSES: 0,
        POSITION_SIZE: 0,
        SESSION_RISK: 0,
        SIGNAL_QUALITY: 0,
        NEWS_CONFLICT: 0,
        DATA_STALE: 0,
        OTHER: 0
      },

      // Performance by pair
      byPair: {},

      // Performance by session
      bySession: {
        LONDON: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        NEW_YORK: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        TOKYO: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        SYDNEY: { trades: 0, wins: 0, losses: 0, pnl: 0 }
      },

      // System health
      system: {
        dataOutages: 0,
        wsDisconnects: 0,
        apiErrors: 0,
        dbErrors: 0
      },

      // Timestamps
      lastUpdate: null,
      startTime: Date.now()
    };

    // Store time-series data
    this.timeSeries = [];
    
    // Store latency samples (keep last 1000 per source)
    this.maxLatencySamples = 1000;
  }

  /**
   * Record trade outcome
   */
  recordTrade(trade) {
    const { pair, pnl, session, isWin } = trade;

    // Update overall metrics
    this.metrics.trades.total++;
    
    if (isWin) {
      this.metrics.trades.wins++;
      this.metrics.trades.currentStreak = Math.max(0, this.metrics.trades.currentStreak + 1);
      
      if (this.metrics.trades.currentStreak > this.metrics.trades.maxWinStreak) {
        this.metrics.trades.maxWinStreak = this.metrics.trades.currentStreak;
      }
    } else {
      this.metrics.trades.losses++;
      this.metrics.trades.currentStreak = Math.min(0, this.metrics.trades.currentStreak - 1);
      
      if (Math.abs(this.metrics.trades.currentStreak) > this.metrics.trades.maxLossStreak) {
        this.metrics.trades.maxLossStreak = Math.abs(this.metrics.trades.currentStreak);
      }
    }

    // Update by pair
    if (!this.metrics.byPair[pair]) {
      this.metrics.byPair[pair] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
    }
    this.metrics.byPair[pair].trades++;
    this.metrics.byPair[pair][isWin ? 'wins' : 'losses']++;
    this.metrics.byPair[pair].pnl += pnl;

    // Update by session
    if (session && this.metrics.bySession[session]) {
      this.metrics.bySession[session].trades++;
      this.metrics.bySession[session][isWin ? 'wins' : 'losses']++;
      this.metrics.bySession[session].pnl += pnl;
    }

    this.metrics.lastUpdate = Date.now();

    logger.debug('Trade metric recorded', {
      pair,
      isWin,
      winStreak: Math.max(0, this.metrics.trades.currentStreak),
      lossStreak: Math.abs(Math.min(0, this.metrics.trades.currentStreak))
    });
  }

  /**
   * Record trade rejection
   */
  recordRejection(reason) {
    this.metrics.trades.rejectedTrades++;
    
    // Categorize rejection reason
    const category = this.categorizeRejection(reason);
    this.metrics.rejections[category]++;

    logger.info('Trade rejection recorded', { reason, category });
  }

  /**
   * Categorize rejection reason
   */
  categorizeRejection(reason) {
    const reasonLower = reason.toLowerCase();
    
    if (reasonLower.includes('cooldown')) return 'COOLDOWN';
    if (reasonLower.includes('daily loss')) return 'DAILY_LOSS';
    if (reasonLower.includes('weekly loss')) return 'WEEKLY_LOSS';
    if (reasonLower.includes('consecutive')) return 'CONSECUTIVE_LOSSES';
    if (reasonLower.includes('position size')) return 'POSITION_SIZE';
    if (reasonLower.includes('session risk')) return 'SESSION_RISK';
    if (reasonLower.includes('quality')) return 'SIGNAL_QUALITY';
    if (reasonLower.includes('news')) return 'NEWS_CONFLICT';
    if (reasonLower.includes('stale') || reasonLower.includes('fresh')) return 'DATA_STALE';
    
    return 'OTHER';
  }

  /**
   * Record latency measurement
   */
  recordLatency(source, latencyMs) {
    if (!this.metrics.latency[source]) {
      this.metrics.latency[source] = [];
    }

    this.metrics.latency[source].push({
      timestamp: Date.now(),
      value: latencyMs
    });

    // Keep only last N samples
    if (this.metrics.latency[source].length > this.maxLatencySamples) {
      this.metrics.latency[source].shift();
    }

    // Check for high latency alert
    if (latencyMs > 5000) {
      logger.warn('High latency detected', { source, latencyMs });
    }
  }

  /**
   * Record system event
   */
  recordSystemEvent(event) {
    const { type } = event;
    
    switch (type) {
      case 'DATA_OUTAGE':
        this.metrics.system.dataOutages++;
        break;
      case 'WS_DISCONNECT':
        this.metrics.system.wsDisconnects++;
        break;
      case 'API_ERROR':
        this.metrics.system.apiErrors++;
        break;
      case 'DB_ERROR':
        this.metrics.system.dbErrors++;
        break;
    }

    logger.warn('System event recorded', event);
  }

  /**
   * Get latency statistics for a source
   */
  getLatencyStats(source) {
    const samples = this.metrics.latency[source] || [];
    
    if (samples.length === 0) {
      return { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }

    const values = samples.map(s => s.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)]
    };
  }

  /**
   * Get win/loss streaks
   */
  getStreaks() {
    return {
      current: {
        type: this.metrics.trades.currentStreak >= 0 ? 'WIN' : 'LOSS',
        length: Math.abs(this.metrics.trades.currentStreak)
      },
      maxWin: this.metrics.trades.maxWinStreak,
      maxLoss: this.metrics.trades.maxLossStreak
    };
  }

  /**
   * Get rejection rate
   */
  getRejectionRate() {
    const total = this.metrics.trades.total + this.metrics.trades.rejectedTrades;
    if (total === 0) return 0;
    
    return this.metrics.trades.rejectedTrades / total;
  }

  /**
   * Get comprehensive metrics report
   */
  getMetricsReport() {
    const winRate = this.metrics.trades.total > 0 
      ? (this.metrics.trades.wins / this.metrics.trades.total) * 100 
      : 0;

    const rejectionRate = this.getRejectionRate() * 100;

    return {
      summary: {
        totalTrades: this.metrics.trades.total,
        wins: this.metrics.trades.wins,
        losses: this.metrics.trades.losses,
        winRate: winRate.toFixed(2) + '%',
        rejectedTrades: this.metrics.trades.rejectedTrades,
        rejectionRate: rejectionRate.toFixed(2) + '%'
      },

      streaks: this.getStreaks(),

      latency: Object.keys(this.metrics.latency).reduce((acc, source) => {
        acc[source] = this.getLatencyStats(source);
        return acc;
      }, {}),

      rejections: this.metrics.rejections,

      byPair: Object.keys(this.metrics.byPair).map(pair => ({
        pair,
        ...this.metrics.byPair[pair],
        winRate: this.metrics.byPair[pair].trades > 0
          ? ((this.metrics.byPair[pair].wins / this.metrics.byPair[pair].trades) * 100).toFixed(2) + '%'
          : '0%'
      })),

      bySession: Object.keys(this.metrics.bySession).map(session => ({
        session,
        ...this.metrics.bySession[session],
        winRate: this.metrics.bySession[session].trades > 0
          ? ((this.metrics.bySession[session].wins / this.metrics.bySession[session].trades) * 100).toFixed(2) + '%'
          : '0%'
      })),

      system: this.metrics.system,

      uptime: {
        seconds: Math.floor((Date.now() - this.metrics.startTime) / 1000),
        readable: this.formatUptime(Date.now() - this.metrics.startTime)
      }
    };
  }

  /**
   * Format uptime duration
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Snapshot current metrics for time series
   */
  snapshotMetrics() {
    const snapshot = {
      timestamp: Date.now(),
      trades: { ...this.metrics.trades },
      rejectionRate: this.getRejectionRate(),
      winRate: this.metrics.trades.total > 0 
        ? (this.metrics.trades.wins / this.metrics.trades.total) 
        : 0
    };

    this.timeSeries.push(snapshot);

    // Keep only last 24 hours of snapshots (assuming 1 min interval = 1440 snapshots)
    if (this.timeSeries.length > 1440) {
      this.timeSeries.shift();
    }

    return snapshot;
  }

  /**
   * Get time series data
   */
  getTimeSeries(lastNMinutes = 60) {
    const cutoff = Date.now() - (lastNMinutes * 60 * 1000);
    return this.timeSeries.filter(s => s.timestamp > cutoff);
  }

  /**
   * Reset metrics
   */
  reset() {
    logger.info('Resetting metrics', { 
      previousTotalTrades: this.metrics.trades.total 
    });

    this.metrics = {
      trades: {
        total: 0,
        wins: 0,
        losses: 0,
        winStreak: 0,
        lossStreak: 0,
        currentStreak: 0,
        maxWinStreak: 0,
        maxLossStreak: 0,
        rejectedTrades: 0
      },
      latency: {
        EA_PRICE: [],
        RSS_NEWS: [],
        TWELVE_DATA: [],
        WEBSOCKET: [],
        DATABASE: []
      },
      rejections: {
        RISK_LIMIT: 0,
        COOLDOWN: 0,
        DAILY_LOSS: 0,
        WEEKLY_LOSS: 0,
        CONSECUTIVE_LOSSES: 0,
        POSITION_SIZE: 0,
        SESSION_RISK: 0,
        SIGNAL_QUALITY: 0,
        NEWS_CONFLICT: 0,
        DATA_STALE: 0,
        OTHER: 0
      },
      byPair: {},
      bySession: {
        LONDON: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        NEW_YORK: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        TOKYO: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        SYDNEY: { trades: 0, wins: 0, losses: 0, pnl: 0 }
      },
      system: {
        dataOutages: 0,
        wsDisconnects: 0,
        apiErrors: 0,
        dbErrors: 0
      },
      lastUpdate: null,
      startTime: Date.now()
    };

    this.timeSeries = [];
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();

// Auto-snapshot every minute
setInterval(() => {
  metricsCollector.snapshotMetrics();
}, 60000);

export default metricsCollector;
