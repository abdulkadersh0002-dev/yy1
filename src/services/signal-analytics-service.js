/**
 * Signal Analytics Service
 * Tracks and analyzes signal performance, win rates, and quality metrics
 * Provides real-time analytics and historical performance data
 */

export class SignalAnalyticsService {
  constructor({ logger, storage }) {
    this.logger = logger;
    this.storage = storage;
    
    // In-memory cache for real-time analytics
    this.realtimeData = {
      activeSignals: new Map(),
      completedSignals: [],
      performance: {
        totalSignals: 0,
        totalWins: 0,
        totalLosses: 0,
        totalProfit: 0,
        totalLoss: 0,
        winRate: 0,
        profitFactor: 0,
        averageRR: 0,
        bestSignal: null,
        worstSignal: null
      },
      byPair: new Map(),
      byTimeframe: {
        today: { signals: 0, wins: 0, profit: 0 },
        week: { signals: 0, wins: 0, profit: 0 },
        month: { signals: 0, wins: 0, profit: 0 }
      },
      qualityMetrics: {
        averageWinProbability: 0,
        averageQualityScore: 0,
        averageConfidence: 0
      }
    };
  }

  /**
   * Record a new signal
   */
  async recordSignal(signal) {
    try {
      const signalRecord = {
        id: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        strength: signal.strength,
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskRewardRatio,
        winProbability: signal.winProbability,
        qualityScore: signal.qualityScore,
        timestamp: signal.timestamp || new Date().toISOString(),
        status: 'ACTIVE',
        outcome: null,
        profitLoss: null,
        closeTime: null,
        closePrice: null,
        closeReason: null
      };

      // Add to active signals
      this.realtimeData.activeSignals.set(signal.id, signalRecord);

      // Update pair statistics
      if (!this.realtimeData.byPair.has(signal.pair)) {
        this.realtimeData.byPair.set(signal.pair, {
          totalSignals: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalProfit: 0
        });
      }

      const pairStats = this.realtimeData.byPair.get(signal.pair);
      pairStats.totalSignals++;

      // Update quality metrics
      this.updateQualityMetrics();

      // Persist to storage
      if (this.storage) {
        await this.storage.saveSignal(signalRecord);
      }

      this.logger?.info?.({ signalId: signal.id }, 'Signal recorded in analytics');

      return signalRecord;
    } catch (error) {
      this.logger?.error?.({ err: error }, 'Failed to record signal');
      throw error;
    }
  }

  /**
   * Record signal outcome (win/loss)
   */
  async recordOutcome(signalId, outcome) {
    try {
      const signal = this.realtimeData.activeSignals.get(signalId);
      if (!signal) {
        throw new Error(`Signal ${signalId} not found in active signals`);
      }

      // Update signal record
      signal.status = 'COMPLETED';
      signal.outcome = outcome.result; // 'WIN' or 'LOSS'
      signal.profitLoss = outcome.profitLoss || 0;
      signal.closeTime = outcome.closeTime || new Date().toISOString();
      signal.closePrice = outcome.closePrice;
      signal.closeReason = outcome.reason;

      // Move from active to completed
      this.realtimeData.activeSignals.delete(signalId);
      this.realtimeData.completedSignals.push(signal);

      // Update performance metrics
      this.realtimeData.performance.totalSignals++;

      if (outcome.result === 'WIN') {
        this.realtimeData.performance.totalWins++;
        this.realtimeData.performance.totalProfit += Math.abs(outcome.profitLoss || 0);
      } else {
        this.realtimeData.performance.totalLosses++;
        this.realtimeData.performance.totalLoss += Math.abs(outcome.profitLoss || 0);
      }

      // Update win rate
      this.realtimeData.performance.winRate =
        (this.realtimeData.performance.totalWins / this.realtimeData.performance.totalSignals) * 100;

      // Update profit factor
      this.realtimeData.performance.profitFactor =
        this.realtimeData.performance.totalLoss > 0
          ? this.realtimeData.performance.totalProfit / this.realtimeData.performance.totalLoss
          : this.realtimeData.performance.totalProfit;

      // Update pair statistics
      const pairStats = this.realtimeData.byPair.get(signal.pair);
      if (pairStats) {
        if (outcome.result === 'WIN') {
          pairStats.wins++;
          pairStats.totalProfit += Math.abs(outcome.profitLoss || 0);
        } else {
          pairStats.losses++;
        }
        pairStats.winRate = (pairStats.wins / pairStats.totalSignals) * 100;
      }

      // Update timeframe statistics
      this.updateTimeframeStats(signal, outcome);

      // Update best/worst signals
      this.updateBestWorst(signal);

      // Persist to storage
      if (this.storage) {
        await this.storage.updateSignalOutcome(signalId, outcome);
      }

      this.logger?.info?.({
        signalId,
        outcome: outcome.result,
        profitLoss: outcome.profitLoss
      }, 'Signal outcome recorded');

      return signal;
    } catch (error) {
      this.logger?.error?.({ err: error, signalId }, 'Failed to record outcome');
      throw error;
    }
  }

  /**
   * Get real-time analytics
   */
  getRealTimeAnalytics() {
    return {
      activeSignals: Array.from(this.realtimeData.activeSignals.values()),
      activeCount: this.realtimeData.activeSignals.size,
      performance: {
        ...this.realtimeData.performance,
        winRate: `${this.realtimeData.performance.winRate.toFixed(2)  }%`,
        profitFactor: this.realtimeData.performance.profitFactor.toFixed(2)
      },
      byPair: Object.fromEntries(
        Array.from(this.realtimeData.byPair.entries()).map(([pair, stats]) => [
          pair,
          {
            ...stats,
            winRate: `${stats.winRate.toFixed(2)  }%`
          }
        ])
      ),
      byTimeframe: this.realtimeData.byTimeframe,
      qualityMetrics: this.realtimeData.qualityMetrics,
      recentSignals: this.realtimeData.completedSignals.slice(-10).reverse()
    };
  }

  /**
   * Get signal history with filters
   */
  async getSignalHistory(filters = {}) {
    try {
      const {
        pair,
        outcome,
        startDate,
        endDate,
        minWinProbability,
        limit = 100,
        offset = 0
      } = filters;

      let signals = [...this.realtimeData.completedSignals];

      // Apply filters
      if (pair) {
        signals = signals.filter(s => s.pair === pair);
      }
      if (outcome) {
        signals = signals.filter(s => s.outcome === outcome);
      }
      if (startDate) {
        signals = signals.filter(s => new Date(s.timestamp) >= new Date(startDate));
      }
      if (endDate) {
        signals = signals.filter(s => new Date(s.timestamp) <= new Date(endDate));
      }
      if (minWinProbability) {
        signals = signals.filter(s => s.winProbability >= minWinProbability);
      }

      // Sort by timestamp (newest first)
      signals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Apply pagination
      const total = signals.length;
      const paginated = signals.slice(offset, offset + limit);

      return {
        signals: paginated,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (error) {
      this.logger?.error?.({ err: error }, 'Failed to get signal history');
      throw error;
    }
  }

  /**
   * Get performance by pair
   */
  getPerformanceByPair() {
    const pairPerformance = [];

    for (const [pair, stats] of this.realtimeData.byPair.entries()) {
      pairPerformance.push({
        pair,
        totalSignals: stats.totalSignals,
        wins: stats.wins,
        losses: stats.losses,
        winRate: `${stats.winRate.toFixed(2)  }%`,
        totalProfit: stats.totalProfit.toFixed(2),
        averageProfit: stats.wins > 0 ? (stats.totalProfit / stats.wins).toFixed(2) : '0.00'
      });
    }

    // Sort by win rate (descending)
    pairPerformance.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    return pairPerformance;
  }

  /**
   * Get signal quality analysis
   */
  getQualityAnalysis() {
    const completed = this.realtimeData.completedSignals;
    if (completed.length === 0) {
      return {
        message: 'No completed signals yet',
        analysis: null
      };
    }

    // Group by quality score ranges
    const qualityRanges = {
      'excellent (90-100)': { signals: 0, wins: 0, winRate: 0 },
      'great (80-89)': { signals: 0, wins: 0, winRate: 0 },
      'good (70-79)': { signals: 0, wins: 0, winRate: 0 },
      'average (60-69)': { signals: 0, wins: 0, winRate: 0 },
      'below-average (<60)': { signals: 0, wins: 0, winRate: 0 }
    };

    completed.forEach(signal => {
      let range;
      if (signal.qualityScore >= 90) {range = 'excellent (90-100)';}
      else if (signal.qualityScore >= 80) {range = 'great (80-89)';}
      else if (signal.qualityScore >= 70) {range = 'good (70-79)';}
      else if (signal.qualityScore >= 60) {range = 'average (60-69)';}
      else {range = 'below-average (<60)';}

      qualityRanges[range].signals++;
      if (signal.outcome === 'WIN') {
        qualityRanges[range].wins++;
      }
    });

    // Calculate win rates
    Object.keys(qualityRanges).forEach(range => {
      const data = qualityRanges[range];
      data.winRate = data.signals > 0
        ? `${((data.wins / data.signals) * 100).toFixed(2)  }%`
        : '0%';
    });

    return {
      qualityRanges,
      recommendation: 'Focus on signals with quality score >= 80 for best results'
    };
  }

  /**
   * Update quality metrics
   */
  updateQualityMetrics() {
    const signals = Array.from(this.realtimeData.activeSignals.values());
    if (signals.length === 0) {return;}

    const totalWinProb = signals.reduce((sum, s) => sum + (s.winProbability || 0), 0);
    const totalQuality = signals.reduce((sum, s) => sum + (s.qualityScore || 0), 0);
    const totalConfidence = signals.reduce((sum, s) => sum + (s.confidence || 0), 0);

    this.realtimeData.qualityMetrics.averageWinProbability = (totalWinProb / signals.length) * 100;
    this.realtimeData.qualityMetrics.averageQualityScore = totalQuality / signals.length;
    this.realtimeData.qualityMetrics.averageConfidence = totalConfidence / signals.length;
  }

  /**
   * Update timeframe statistics
   */
  updateTimeframeStats(signal, outcome) {
    const signalDate = new Date(signal.timestamp);
    const now = new Date();
    
    const daysDiff = Math.floor((now - signalDate) / (1000 * 60 * 60 * 24));

    // Today
    if (daysDiff === 0) {
      this.realtimeData.byTimeframe.today.signals++;
      if (outcome.result === 'WIN') {
        this.realtimeData.byTimeframe.today.wins++;
        this.realtimeData.byTimeframe.today.profit += Math.abs(outcome.profitLoss || 0);
      }
    }

    // This week
    if (daysDiff <= 7) {
      this.realtimeData.byTimeframe.week.signals++;
      if (outcome.result === 'WIN') {
        this.realtimeData.byTimeframe.week.wins++;
        this.realtimeData.byTimeframe.week.profit += Math.abs(outcome.profitLoss || 0);
      }
    }

    // This month
    if (daysDiff <= 30) {
      this.realtimeData.byTimeframe.month.signals++;
      if (outcome.result === 'WIN') {
        this.realtimeData.byTimeframe.month.wins++;
        this.realtimeData.byTimeframe.month.profit += Math.abs(outcome.profitLoss || 0);
      }
    }
  }

  /**
   * Update best/worst signals
   */
  updateBestWorst(signal) {
    if (!this.realtimeData.performance.bestSignal || 
        (signal.profitLoss > this.realtimeData.performance.bestSignal.profitLoss)) {
      this.realtimeData.performance.bestSignal = signal;
    }

    if (!this.realtimeData.performance.worstSignal || 
        (signal.profitLoss < this.realtimeData.performance.worstSignal.profitLoss)) {
      this.realtimeData.performance.worstSignal = signal;
    }
  }

  /**
   * Reset statistics (for testing or new period)
   */
  resetStats() {
    this.realtimeData.completedSignals = [];
    this.realtimeData.performance = {
      totalSignals: 0,
      totalWins: 0,
      totalLosses: 0,
      totalProfit: 0,
      totalLoss: 0,
      winRate: 0,
      profitFactor: 0,
      averageRR: 0,
      bestSignal: null,
      worstSignal: null
    };
    this.realtimeData.byPair.clear();
    this.realtimeData.byTimeframe = {
      today: { signals: 0, wins: 0, profit: 0 },
      week: { signals: 0, wins: 0, profit: 0 },
      month: { signals: 0, wins: 0, profit: 0 }
    };
    
    this.logger?.info?.('Analytics statistics reset');
  }
}
