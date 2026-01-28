/**
 * Decision Scoring Model
 * Replaces IF/ELSE logic with comprehensive scoring system
 * Calculates Context Score, Signal Score, and Risk Score for intelligent decisions
 */

import logger from '../logging/logger.js';

class DecisionScoringModel {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    
    // Score weights (total = 100)
    this.weights = {
      contextScore: options.contextWeight || 30,  // 30% - market conditions, timing
      signalScore: options.signalWeight || 40,    // 40% - technical analysis quality
      riskScore: options.riskWeight || 30         // 30% - news, volatility, exposure
    };
    
    // Minimum thresholds
    this.minEntryScore = options.minEntryScore || 65;  // 65/100 to enter
    this.minHoldScore = options.minHoldScore || 45;    // 45/100 to hold
    this.emergencyExitScore = options.emergencyExitScore || 25; // Exit below 25
    
    // Score history for trend analysis
    this.scoreHistory = new Map(); // tradeId -> [{ timestamp, score, reason }]
    this.maxHistorySize = 100;
  }

  /**
   * Calculate comprehensive trade score
   * Returns: { totalScore, breakdown, decision, reasons }
   */
  calculateTradeScore({ signal, context, risk, tradeId = null }) {
    const contextScore = this.calculateContextScore(context);
    const signalScore = this.calculateSignalScore(signal);
    const riskScore = this.calculateRiskScore(risk);
    
    // Weighted combination
    const totalScore = Math.round(
      (contextScore.score * this.weights.contextScore / 100) +
      (signalScore.score * this.weights.signalScore / 100) +
      (riskScore.score * this.weights.riskScore / 100)
    );
    
    // Determine decision
    const decision = this.determineDecision(totalScore, tradeId);
    
    // Combine all reasons
    const reasons = [
      ...contextScore.reasons,
      ...signalScore.reasons,
      ...riskScore.reasons
    ];
    
    const result = {
      totalScore,
      breakdown: {
        context: contextScore,
        signal: signalScore,
        risk: riskScore
      },
      decision,
      reasons,
      timestamp: Date.now()
    };
    
    // Track score history if tradeId provided
    if (tradeId) {
      this.recordScoreHistory(tradeId, result);
    }
    
    return result;
  }

  /**
   * Calculate Context Score (0-100)
   * Evaluates market conditions, timing, and liquidity
   */
  calculateContextScore(context = {}) {
    let score = 50; // Start neutral
    const reasons = [];
    
    // Market phase (0-25 points)
    const phase = context.marketPhase;
    if (phase) {
      if (phase === 'expansion' || phase === 'accumulation') {
        score += 20;
        reasons.push(`Market phase favorable: ${phase}`);
      } else if (phase === 'distribution' || phase === 'retracement') {
        score += 10;
        reasons.push(`Market phase neutral: ${phase}`);
      } else {
        reasons.push(`Market phase unclear: ${phase}`);
      }
    }
    
    // Trading session (0-15 points)
    const session = context.tradingSession;
    if (session === 'london' || session === 'newyork' || session === 'overlap') {
      score += 15;
      reasons.push('Active trading session');
    } else if (session === 'asian') {
      score += 8;
      reasons.push('Asian session (lower liquidity)');
    } else if (session === 'offhours') {
      score -= 10;
      reasons.push('Off-hours (avoid)');
    }
    
    // Liquidity (0-10 points)
    const liquidity = context.liquidity;
    if (liquidity && liquidity >= 0.8) {
      score += 10;
      reasons.push('High liquidity');
    } else if (liquidity && liquidity >= 0.5) {
      score += 5;
      reasons.push('Normal liquidity');
    } else if (liquidity && liquidity < 0.5) {
      score -= 5;
      reasons.push('Low liquidity warning');
    }
    
    // Spread conditions (0-10 points)
    const spread = context.spread;
    const normalSpread = context.normalSpread || 0.0015;
    if (spread && spread <= normalSpread) {
      score += 10;
      reasons.push('Tight spread');
    } else if (spread && spread <= normalSpread * 2) {
      score += 5;
      reasons.push('Normal spread');
    } else if (spread && spread > normalSpread * 3) {
      score -= 10;
      reasons.push('Wide spread warning');
    }
    
    return {
      score: Math.max(0, Math.min(100, score)),
      reasons,
      category: 'Context'
    };
  }

  /**
   * Calculate Signal Score (0-100)
   * Evaluates technical analysis quality
   */
  calculateSignalScore(signal = {}) {
    let score = 0;
    const reasons = [];
    
    // Base confidence and strength (0-40 points)
    const confidence = signal.confidence || 0;
    const strength = signal.strength || 0;
    
    score += confidence * 0.25; // Up to 25 points from confidence
    score += strength * 0.15;   // Up to 15 points from strength
    
    if (confidence >= 70) {
      reasons.push(`High confidence: ${confidence}%`);
    } else if (confidence < 50) {
      reasons.push(`Low confidence warning: ${confidence}%`);
    }
    
    // Multi-timeframe alignment (0-20 points)
    const mtfAlignment = signal.multiTimeframeAlignment;
    if (mtfAlignment >= 0.8) {
      score += 20;
      reasons.push('Strong multi-timeframe alignment');
    } else if (mtfAlignment >= 0.6) {
      score += 12;
      reasons.push('Good multi-timeframe alignment');
    } else if (mtfAlignment < 0.4) {
      score -= 5;
      reasons.push('Weak multi-timeframe alignment');
    }
    
    // Confluence layers (0-20 points)
    const confluence = signal.confluence || 0;
    if (confluence >= 80) {
      score += 20;
      reasons.push(`Excellent confluence: ${confluence}%`);
    } else if (confluence >= 60) {
      score += 15;
      reasons.push(`Good confluence: ${confluence}%`);
    } else if (confluence >= 40) {
      score += 10;
      reasons.push(`Moderate confluence: ${confluence}%`);
    } else {
      reasons.push(`Low confluence: ${confluence}%`);
    }
    
    // Signal freshness (0-10 points)
    const age = signal.age || 0;
    if (age < 60000) { // Less than 1 minute
      score += 10;
      reasons.push('Fresh signal');
    } else if (age < 300000) { // Less than 5 minutes
      score += 5;
      reasons.push('Recent signal');
    } else if (age > 600000) { // More than 10 minutes
      score -= 10;
      reasons.push('Stale signal warning');
    }
    
    // Trend alignment (0-10 points)
    const trendAlignment = signal.trendAlignment;
    if (trendAlignment === 'aligned') {
      score += 10;
      reasons.push('Aligned with trend');
    } else if (trendAlignment === 'counter') {
      score -= 5;
      reasons.push('Counter-trend (higher risk)');
    }
    
    return {
      score: Math.max(0, Math.min(100, score)),
      reasons,
      category: 'Signal'
    };
  }

  /**
   * Calculate Risk Score (0-100)
   * Evaluates news, volatility, and exposure risks
   * Note: Higher score = Lower risk
   */
  calculateRiskScore(risk = {}) {
    let score = 100; // Start with maximum (lowest risk)
    const reasons = [];
    
    // News impact (0-40 points penalty)
    const newsImpact = risk.newsImpact;
    if (newsImpact) {
      if (newsImpact.level === 'high') {
        score -= 40;
        reasons.push(`High-impact news: ${newsImpact.type || 'major event'}`);
      } else if (newsImpact.level === 'medium') {
        score -= 20;
        reasons.push(`Medium-impact news: ${newsImpact.type || 'event'}`);
      } else if (newsImpact.level === 'low') {
        score -= 5;
        reasons.push('Low-impact news present');
      }
      
      // Timing penalty
      if (newsImpact.timing === 'imminent') {
        score -= 15;
        reasons.push('News imminent (< 15 min)');
      } else if (newsImpact.timing === 'during') {
        score -= 25;
        reasons.push('News event ongoing');
      }
    } else {
      reasons.push('No major news conflicts');
    }
    
    // Volatility risk (0-30 points penalty)
    const volatility = risk.volatility;
    if (volatility === 'extreme') {
      score -= 30;
      reasons.push('Extreme volatility');
    } else if (volatility === 'high') {
      score -= 15;
      reasons.push('High volatility');
    } else if (volatility === 'low') {
      score -= 5;
      reasons.push('Low volatility (choppy risk)');
    } else if (volatility === 'normal') {
      reasons.push('Normal volatility');
    }
    
    // Exposure risk (0-20 points penalty)
    const exposure = risk.exposure || 0;
    if (exposure > 0.8) {
      score -= 20;
      reasons.push('High exposure warning');
    } else if (exposure > 0.6) {
      score -= 10;
      reasons.push('Elevated exposure');
    } else if (exposure < 0.3) {
      reasons.push('Low exposure');
    }
    
    // Correlation risk (0-10 points penalty)
    const correlation = risk.correlationRisk;
    if (correlation === 'high') {
      score -= 10;
      reasons.push('High correlation with existing positions');
    } else if (correlation === 'medium') {
      score -= 5;
      reasons.push('Moderate correlation');
    }
    
    return {
      score: Math.max(0, Math.min(100, score)),
      reasons,
      category: 'Risk'
    };
  }

  /**
   * Determine decision based on total score
   */
  determineDecision(totalScore, tradeId = null) {
    let action = 'HOLD';
    let confidence = 'MEDIUM';
    
    if (!tradeId) {
      // Entry decision
      if (totalScore >= this.minEntryScore) {
        action = 'ENTER';
        confidence = totalScore >= 80 ? 'HIGH' : totalScore >= 70 ? 'MEDIUM' : 'LOW';
      } else {
        action = 'REJECT';
        confidence = totalScore >= 55 ? 'MEDIUM' : 'HIGH';
      }
    } else {
      // Exit/hold decision for existing trade
      const history = this.getScoreHistory(tradeId);
      const trend = this.analyzeScoreTrend(history);
      
      if (totalScore < this.emergencyExitScore) {
        action = 'EXIT_NOW';
        confidence = 'HIGH';
      } else if (totalScore < this.minHoldScore) {
        action = 'EXIT';
        confidence = trend === 'declining' ? 'HIGH' : 'MEDIUM';
      } else if (totalScore >= 75) {
        action = 'HOLD';
        confidence = 'HIGH';
      } else {
        action = 'HOLD';
        confidence = 'MEDIUM';
      }
    }
    
    return { action, confidence, score: totalScore };
  }

  /**
   * Record score history for a trade
   */
  recordScoreHistory(tradeId, scoreResult) {
    if (!this.scoreHistory.has(tradeId)) {
      this.scoreHistory.set(tradeId, []);
    }
    
    const history = this.scoreHistory.get(tradeId);
    history.push({
      timestamp: scoreResult.timestamp,
      score: scoreResult.totalScore,
      breakdown: scoreResult.breakdown,
      reasons: scoreResult.reasons
    });
    
    // Keep bounded
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * Get score history for a trade
   */
  getScoreHistory(tradeId) {
    return this.scoreHistory.get(tradeId) || [];
  }

  /**
   * Analyze score trend
   */
  analyzeScoreTrend(history) {
    if (history.length < 2) {
      return 'stable';
    }
    
    const recent = history.slice(-5); // Last 5 scores
    let increases = 0;
    let decreases = 0;
    
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].score > recent[i - 1].score) {
        increases++;
      } else if (recent[i].score < recent[i - 1].score) {
        decreases++;
      }
    }
    
    if (decreases >= increases * 2) {
      return 'declining';
    } else if (increases >= decreases * 2) {
      return 'improving';
    }
    
    return 'stable';
  }

  /**
   * Clear history for a trade (when closed)
   */
  clearTradeHistory(tradeId) {
    this.scoreHistory.delete(tradeId);
  }

  /**
   * Get score explanation
   */
  explainScore(scoreResult) {
    const { totalScore, breakdown, decision, reasons } = scoreResult;
    
    return {
      summary: `Total Score: ${totalScore}/100 → ${decision.action} (${decision.confidence} confidence)`,
      breakdown: {
        context: `${breakdown.context.score}/100 (${this.weights.contextScore}% weight)`,
        signal: `${breakdown.signal.score}/100 (${this.weights.signalWeight}% weight)`,
        risk: `${breakdown.risk.score}/100 (${this.weights.riskScore}% weight)`
      },
      reasons: reasons,
      recommendation: this.getRecommendation(totalScore, decision.action)
    };
  }

  /**
   * Get recommendation based on score and action
   */
  getRecommendation(score, action) {
    if (action === 'ENTER' && score >= 80) {
      return 'Excellent setup - full position recommended';
    } else if (action === 'ENTER' && score >= 70) {
      return 'Good setup - standard position recommended';
    } else if (action === 'ENTER' && score >= 65) {
      return 'Acceptable setup - reduced position recommended';
    } else if (action === 'REJECT') {
      return 'Setup below threshold - skip this trade';
    } else if (action === 'EXIT_NOW') {
      return 'Emergency exit - close immediately';
    } else if (action === 'EXIT') {
      return 'Score deteriorating - consider exit';
    } else if (action === 'HOLD' && score >= 75) {
      return 'Strong position - hold confidently';
    } else {
      return 'Monitor closely - be ready to exit';
    }
  }
}

export default DecisionScoringModel;
