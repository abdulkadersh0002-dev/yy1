/**
 * Intelligent Trade Manager
 * Advanced trade management with human-like decision making
 * Monitors market conditions, news impact, and profit protection
 */

import logger from '../../services/logging/logger.js';

class IntelligentTradeManager {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.eaBridgeService = options.eaBridgeService;
    this.newsAggregator = options.newsAggregator;
    
    // Market condition awareness
    this.marketPhaseCache = new Map(); // symbol -> { phase, confidence, lastUpdate }
    this.volatilityCache = new Map(); // symbol -> { state, value, lastUpdate }
    
    // News impact tracking
    this.recentHighImpactNews = new Map(); // currency -> { items: [], lastUpdate }
    this.newsAvoidanceWindow = 15 * 60 * 1000; // 15 minutes before/after news
    
    // Profit protection settings
    this.profitProtectionThreshold = 0.6; // 60% of TP reached
    this.trailingStopActivation = 0.4; // 40% of TP reached
    this.emergencyExitThreshold = -0.8; // -80% of SL (emergency exit)
    
    // Trade quality scoring cache
    this.tradeQualityScores = new Map(); // tradeId -> quality score
    
    // Performance tracking per symbol
    this.symbolPerformance = new Map(); // symbol -> { wins, losses, avgProfit, avgLoss }
    
    // Market regime awareness
    this.currentRegime = new Map(); // symbol -> 'trending' | 'ranging' | 'volatile'
  }

  /**
   * Evaluate if a trade should be opened based on comprehensive analysis
   * Returns: { shouldOpen: boolean, confidence: number, reasons: string[] }
   */
  evaluateTradeEntry({ signal, broker, symbol, marketData = {} }) {
    const reasons = [];
    let confidence = signal.confidence || 0;
    
    // 1. Check news impact
    const newsCheck = this.checkNewsImpact(symbol);
    if (!newsCheck.safe) {
      return {
        shouldOpen: false,
        confidence: 0,
        reasons: ['High-impact news imminent or ongoing', ...newsCheck.details],
        blocked: 'NEWS_RISK'
      };
    }
    
    // 2. Evaluate market phase suitability
    const phaseCheck = this.evaluateMarketPhase(signal, symbol, marketData);
    if (!phaseCheck.suitable) {
      return {
        shouldOpen: false,
        confidence: 0,
        reasons: ['Market phase unsuitable for entry', ...phaseCheck.reasons],
        blocked: 'MARKET_PHASE'
      };
    }
    confidence = confidence * phaseCheck.adjustmentFactor;
    
    // 3. Check symbol-specific performance
    const symbolCheck = this.evaluateSymbolPerformance(symbol);
    confidence = confidence * symbolCheck.adjustmentFactor;
    reasons.push(...symbolCheck.insights);
    
    // 4. Volatility appropriateness
    const volCheck = this.evaluateVolatility(symbol, signal, marketData);
    if (!volCheck.appropriate) {
      return {
        shouldOpen: false,
        confidence: 0,
        reasons: ['Volatility conditions unfavorable', ...volCheck.reasons],
        blocked: 'VOLATILITY'
      };
    }
    confidence = confidence * volCheck.adjustmentFactor;
    
    // 5. Multi-timeframe confirmation
    const mtfCheck = this.checkMultiTimeframeAlignment(broker, symbol, signal);
    confidence = confidence * mtfCheck.alignmentFactor;
    reasons.push(...mtfCheck.insights);
    
    // Final decision: require 80% confidence for execution
    const shouldOpen = confidence >= 80;
    
    return {
      shouldOpen,
      confidence: Math.round(confidence * 10) / 10,
      reasons: reasons.length > 0 ? reasons : ['All checks passed'],
      qualityScore: this.calculateTradeQuality({ signal, newsCheck, phaseCheck, volCheck, mtfCheck })
    };
  }

  /**
   * Check for high-impact news that could affect the trade
   */
  checkNewsImpact(symbol) {
    const currencies = this.extractCurrencies(symbol);
    const now = Date.now();
    const details = [];
    
    for (const currency of currencies) {
      const newsData = this.recentHighImpactNews.get(currency);
      if (!newsData) {
        continue;
      }
      
      const recentNews = newsData.items.filter(item => {
        const timeDiff = Math.abs(now - item.timestamp);
        return timeDiff < this.newsAvoidanceWindow;
      });
      
      if (recentNews.length > 0) {
        details.push(`${currency}: ${recentNews.length} high-impact event(s) in progress`);
        return { safe: false, details };
      }
    }
    
    return { safe: true, details: ['No major news conflicts'] };
  }

  /**
   * Evaluate if market phase is suitable for the signal direction
   */
  evaluateMarketPhase(signal, symbol, marketData) {
    const phase = this.marketPhaseCache.get(symbol);
    if (!phase) {
      // No phase data, allow but reduce confidence slightly
      return { suitable: true, adjustmentFactor: 0.95, reasons: ['No phase data'] };
    }
    
    const { phase: currentPhase, confidence: phaseConfidence } = phase;
    const direction = signal.direction || 'NEUTRAL';
    
    // Best phases for each direction
    const phaseSuitability = {
      'BUY': {
        'accumulation': 1.1,  // Good for buying
        'expansion': 1.2,     // Excellent for buying
        'distribution': 0.7,  // Poor for buying
        'retracement': 0.9    // Moderate for buying
      },
      'SELL': {
        'accumulation': 0.7,  // Poor for selling
        'expansion': 0.9,     // Moderate for selling
        'distribution': 1.1,  // Good for selling
        'retracement': 1.2    // Excellent for selling
      }
    };
    
    const factor = phaseSuitability[direction]?.[currentPhase] || 0.8;
    const suitable = factor >= 0.9;
    
    return {
      suitable,
      adjustmentFactor: factor,
      reasons: suitable 
        ? [`Market phase (${currentPhase}) aligns with ${direction} direction`]
        : [`Market phase (${currentPhase}) conflicts with ${direction} direction`]
    };
  }

  /**
   * Evaluate symbol-specific historical performance
   */
  evaluateSymbolPerformance(symbol) {
    const perf = this.symbolPerformance.get(symbol);
    if (!perf || (perf.wins + perf.losses) < 5) {
      return { adjustmentFactor: 1.0, insights: ['Insufficient history for symbol'] };
    }
    
    const winRate = perf.wins / (perf.wins + perf.losses);
    const profitFactor = perf.avgProfit / Math.max(perf.avgLoss, 0.01);
    
    let factor = 1.0;
    const insights = [];
    
    if (winRate > 0.65) {
      factor = 1.1;
      insights.push(`Strong ${symbol} performance (${Math.round(winRate * 100)}% win rate)`);
    } else if (winRate < 0.35) {
      factor = 0.7;
      insights.push(`Weak ${symbol} performance (${Math.round(winRate * 100)}% win rate)`);
    }
    
    if (profitFactor > 2.0) {
      factor *= 1.05;
      insights.push(`Excellent profit factor: ${profitFactor.toFixed(2)}`);
    } else if (profitFactor < 1.0) {
      factor *= 0.85;
      insights.push(`Poor profit factor: ${profitFactor.toFixed(2)}`);
    }
    
    return { adjustmentFactor: factor, insights };
  }

  /**
   * Check volatility appropriateness for the signal
   */
  evaluateVolatility(symbol, signal, marketData) {
    const volData = this.volatilityCache.get(symbol);
    if (!volData) {
      return { appropriate: true, adjustmentFactor: 0.95, reasons: ['No volatility data'] };
    }
    
    const { state } = volData;
    const signalStrength = signal.strength || 0;
    
    // Volatility matching logic
    if (state === 'extreme') {
      // Only accept extremely strong signals in extreme volatility
      if (signalStrength < 70) {
        return {
          appropriate: false,
          adjustmentFactor: 0.5,
          reasons: ['Extreme volatility requires stronger signals']
        };
      }
      return { appropriate: true, adjustmentFactor: 0.9, reasons: ['High volatility, strong signal'] };
    }
    
    if (state === 'low' || state === 'calm') {
      // Low volatility - prefer stronger breakout signals
      if (signalStrength < 40) {
        return {
          appropriate: false,
          adjustmentFactor: 0.7,
          reasons: ['Low volatility requires breakout confirmation']
        };
      }
    }
    
    // Normal or high volatility - ideal
    return { appropriate: true, adjustmentFactor: 1.05, reasons: ['Volatility conditions favorable'] };
  }

  /**
   * Check multi-timeframe alignment
   */
  checkMultiTimeframeAlignment(broker, symbol, signal) {
    if (!this.eaBridgeService) {
      return { alignmentFactor: 1.0, insights: ['No EA bridge service'] };
    }
    
    try {
      const timeframes = ['M15', 'H1', 'H4'];
      const analyses = {};
      
      for (const tf of timeframes) {
        const analysis = this.eaBridgeService.getMarketCandleAnalysis({
          broker,
          symbol,
          timeframe: tf,
          limit: 50,
          maxAgeMs: 5 * 60 * 1000 // 5 minutes
        });
        if (analysis) {
          analyses[tf] = analysis;
        }
      }
      
      const direction = signal.direction || 'NEUTRAL';
      let alignedCount = 0;
      let totalCount = 0;
      
      for (const [tf, analysis] of Object.entries(analyses)) {
        if (analysis.direction && analysis.direction !== 'NEUTRAL') {
          totalCount++;
          if (analysis.direction === direction) {
            alignedCount++;
          }
        }
      }
      
      if (totalCount === 0) {
        return { alignmentFactor: 0.95, insights: ['No multi-timeframe data available'] };
      }
      
      const alignmentRatio = alignedCount / totalCount;
      
      if (alignmentRatio >= 0.8) {
        return {
          alignmentFactor: 1.15,
          insights: [`Strong multi-timeframe alignment (${alignedCount}/${totalCount})`]
        };
      } else if (alignmentRatio >= 0.6) {
        return {
          alignmentFactor: 1.05,
          insights: [`Moderate multi-timeframe alignment (${alignedCount}/${totalCount})`]
        };
      } else {
        return {
          alignmentFactor: 0.8,
          insights: [`Weak multi-timeframe alignment (${alignedCount}/${totalCount})`]
        };
      }
    } catch (error) {
      this.logger.warn({ error }, 'Error checking multi-timeframe alignment');
      return { alignmentFactor: 0.95, insights: ['MTF check failed'] };
    }
  }

  /**
   * Calculate overall trade quality score
   */
  calculateTradeQuality({ signal, newsCheck, phaseCheck, volCheck, mtfCheck }) {
    let score = signal.confidence || 50;
    
    // News safety bonus
    if (newsCheck.safe) {
      score += 5;
    }
    
    // Phase alignment bonus
    if (phaseCheck.suitable && phaseCheck.adjustmentFactor > 1.0) {
      score += 10;
    }
    
    // Volatility appropriateness
    if (volCheck.appropriate && volCheck.adjustmentFactor >= 1.0) {
      score += 5;
    }
    
    // MTF alignment bonus
    if (mtfCheck.alignmentFactor > 1.1) {
      score += 10;
    } else if (mtfCheck.alignmentFactor < 0.9) {
      score -= 10;
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Monitor open trade and suggest actions (hold, close, trail stop)
   */
  monitorTrade({ trade, currentPrice, marketData = {} }) {
    const {
      openPrice,
      stopLoss,
      takeProfit,
      direction,
      symbol
    } = trade;
    
    const priceDelta = direction === 'BUY' 
      ? currentPrice - openPrice 
      : openPrice - currentPrice;
    
    const tpDistance = direction === 'BUY'
      ? takeProfit - openPrice
      : openPrice - takeProfit;
    
    const slDistance = direction === 'BUY'
      ? openPrice - stopLoss
      : stopLoss - openPrice;
    
    const profitRatio = priceDelta / tpDistance;
    const lossRatio = -priceDelta / slDistance;
    
    // Emergency exit on severe adverse movement
    if (lossRatio > Math.abs(this.emergencyExitThreshold)) {
      return {
        action: 'CLOSE_NOW',
        reason: 'Emergency exit: severe adverse movement',
        urgency: 'HIGH'
      };
    }
    
    // Profit protection: close when 60% of TP reached
    if (profitRatio >= this.profitProtectionThreshold) {
      // Check if market is still favorable
      const newsCheck = this.checkNewsImpact(symbol);
      if (!newsCheck.safe) {
        return {
          action: 'CLOSE_NOW',
          reason: 'Profit protection + news risk detected',
          urgency: 'MEDIUM'
        };
      }
      
      // Check market phase reversal
      const phase = this.marketPhaseCache.get(symbol);
      if (phase && this.isPhaseReversing(phase, direction)) {
        return {
          action: 'CLOSE_NOW',
          reason: 'Profit protection + market phase reversal',
          urgency: 'MEDIUM'
        };
      }
    }
    
    // Trailing stop activation
    if (profitRatio >= this.trailingStopActivation) {
      const newStopLoss = this.calculateTrailingStop({
        currentPrice,
        openPrice,
        direction,
        profitRatio,
        tpDistance
      });
      
      return {
        action: 'MODIFY_SL',
        newStopLoss,
        reason: `Trailing stop: ${Math.round(profitRatio * 100)}% to TP`,
        urgency: 'LOW'
      };
    }
    
    // Hold the trade
    return {
      action: 'HOLD',
      reason: 'Trade within normal parameters',
      urgency: 'NONE'
    };
  }

  /**
   * Calculate trailing stop loss
   */
  calculateTrailingStop({ currentPrice, openPrice, direction, profitRatio, tpDistance }) {
    // Move SL to protect 30% of current profit
    const profitProtection = 0.3;
    const currentProfit = profitRatio * tpDistance;
    const protectedProfit = currentProfit * profitProtection;
    
    if (direction === 'BUY') {
      return currentPrice - protectedProfit;
    } else {
      return currentPrice + protectedProfit;
    }
  }

  /**
   * Check if market phase is reversing
   */
  isPhaseReversing(phase, tradeDirection) {
    const { phase: currentPhase } = phase;
    
    if (tradeDirection === 'BUY') {
      // Reversal signals for long positions
      return currentPhase === 'distribution';
    } else if (tradeDirection === 'SELL') {
      // Reversal signals for short positions
      return currentPhase === 'accumulation';
    }
    
    return false;
  }

  /**
   * Update market phase cache
   */
  updateMarketPhase(symbol, phase, confidence) {
    this.marketPhaseCache.set(symbol, {
      phase,
      confidence,
      lastUpdate: Date.now()
    });
  }

  /**
   * Update volatility cache
   */
  updateVolatility(symbol, state, value) {
    this.volatilityCache.set(symbol, {
      state,
      value,
      lastUpdate: Date.now()
    });
  }

  /**
   * Record high-impact news
   */
  recordHighImpactNews(currency, newsItem) {
    const existing = this.recentHighImpactNews.get(currency) || { items: [], lastUpdate: 0 };
    existing.items.push({
      ...newsItem,
      timestamp: newsItem.timestamp || Date.now()
    });
    
    // Keep only last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    existing.items = existing.items.filter(item => item.timestamp > oneDayAgo);
    existing.lastUpdate = Date.now();
    
    this.recentHighImpactNews.set(currency, existing);
  }

  /**
   * Update symbol performance
   */
  updateSymbolPerformance(symbol, profit, loss) {
    const perf = this.symbolPerformance.get(symbol) || {
      wins: 0,
      losses: 0,
      avgProfit: 0,
      avgLoss: 0
    };
    
    if (profit > 0) {
      perf.avgProfit = (perf.avgProfit * perf.wins + profit) / (perf.wins + 1);
      perf.wins++;
    } else if (profit < 0) {
      const absLoss = Math.abs(profit);
      perf.avgLoss = (perf.avgLoss * perf.losses + absLoss) / (perf.losses + 1);
      perf.losses++;
    }
    
    this.symbolPerformance.set(symbol, perf);
  }

  /**
   * Extract currencies from symbol (e.g., EURUSD -> ['EUR', 'USD'])
   */
  extractCurrencies(symbol) {
    const clean = symbol.replace(/[^A-Z]/g, '');
    if (clean.length >= 6) {
      return [clean.substring(0, 3), clean.substring(3, 6)];
    }
    return [];
  }

  /**
   * Get trading recommendations based on current state
   */
  getRecommendations() {
    const recommendations = [];
    
    // Check overall market conditions
    let trendingCount = 0;
    let rangingCount = 0;
    
    for (const [symbol, regime] of this.currentRegime.entries()) {
      if (regime === 'trending') {
        trendingCount++;
      } else if (regime === 'ranging') {
        rangingCount++;
      }
    }
    
    if (trendingCount > rangingCount * 2) {
      recommendations.push('Market favors trending strategies - increase trend-following signals');
    } else if (rangingCount > trendingCount * 2) {
      recommendations.push('Market favors mean-reversion - reduce breakout signals');
    }
    
    // Symbol-specific recommendations
    for (const [symbol, perf] of this.symbolPerformance.entries()) {
      if ((perf.wins + perf.losses) >= 10) {
        const winRate = perf.wins / (perf.wins + perf.losses);
        if (winRate < 0.3) {
          recommendations.push(`Avoid ${symbol} - poor recent performance (${Math.round(winRate * 100)}% win rate)`);
        } else if (winRate > 0.7) {
          recommendations.push(`Favor ${symbol} - excellent recent performance (${Math.round(winRate * 100)}% win rate)`);
        }
      }
    }
    
    return recommendations;
  }
}

export default IntelligentTradeManager;
