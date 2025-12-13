/**
 * Integrated Signal Pipeline
 * Combines all analysis sources and filters for ultra-high quality signals
 * Target: 85-100% win rate
 */

import { UltraSignalFilter } from './ultra-signal-filter.js';
import { SignalValidator } from './signal-validator.js';
import { RiskManager } from './risk-manager.js';
import logger from '../../services/logging/logger.js';

export class IntegratedSignalPipeline {
  constructor(options = {}) {
    this.ultraFilter = new UltraSignalFilter(options.ultraFilter || {});
    this.validator = new SignalValidator(options.validator || {});
    this.riskManager = new RiskManager(options.riskManager || {});
    
    this.technicalAnalyzer = options.technicalAnalyzer;
    this.newsAnalyzer = options.newsAnalyzer;
    this.economicAnalyzer = options.economicAnalyzer;
    this.rssSignalGenerator = options.rssSignalGenerator;
    
    this.config = {
      enableMultiSourceConfirmation: options.enableMultiSourceConfirmation !== false,
      requireUltraFilter: options.requireUltraFilter !== false,
      minSourceAgreement: options.minSourceAgreement || 2, // At least 2 sources must agree
      maxSignalsPerHour: options.maxSignalsPerHour || 3,
      ...options
    };
    
    this.signalHistory = [];
    this.performanceMetrics = {
      totalSignals: 0,
      winningSignals: 0,
      losingSignals: 0,
      winRate: 0,
      avgRiskReward: 0
    };
  }

  /**
   * Process and generate ultra-quality trading signals
   * @param {Array} pairs - Currency pairs to analyze
   * @param {Object} context - Market context and active trades
   * @returns {Promise<Array>} Array of ultra-quality signals
   */
  async generateSignals(pairs, context = {}) {
    try {
      logger.info({ pairs: pairs.length }, 'Starting integrated signal pipeline');
      
      // Step 1: Gather all analysis sources
      const multiSourceAnalysis = await this.gatherMultiSourceAnalysis(pairs);
      
      // Step 2: Generate candidate signals from each source
      const candidateSignals = await this.generateCandidateSignals(multiSourceAnalysis, pairs);
      
      // Step 3: Validate signals through standard validator
      const validatedSignals = await this.validateSignals(candidateSignals, context);
      
      // Step 4: Apply ultra-quality filter
      const ultraSignals = await this.applyUltraFilter(validatedSignals, multiSourceAnalysis, context);
      
      // Step 5: Apply risk management and position sizing
      const finalSignals = await this.applyRiskManagement(ultraSignals, context);
      
      // Step 6: Rank and select top signals
      const topSignals = this.rankAndSelectTopSignals(finalSignals);
      
      // Log results
      logger.info({
        candidates: candidateSignals.length,
        validated: validatedSignals.length,
        ultraQuality: ultraSignals.length,
        final: topSignals.length
      }, 'Signal pipeline complete');
      
      // Record signals for performance tracking
      this.recordSignals(topSignals);
      
      return topSignals;
      
    } catch (error) {
      logger.error({ err: error }, 'Signal pipeline failed');
      return [];
    }
  }

  /**
   * Step 1: Gather analysis from all sources
   */
  async gatherMultiSourceAnalysis(pairs) {
    const analysis = {};
    
    for (const pair of pairs) {
      analysis[pair] = {
        pair,
        timestamp: Date.now(),
        sources: {}
      };
      
      // Technical Analysis
      if (this.technicalAnalyzer) {
        try {
          const tech = await this.technicalAnalyzer.analyzeTechnical(pair);
          analysis[pair].sources.technical = tech;
        } catch (error) {
          logger.warn({ err: error, pair }, 'Technical analysis failed');
        }
      }
      
      // News Analysis
      if (this.newsAnalyzer) {
        try {
          const news = await this.newsAnalyzer.analyzeNews(pair);
          analysis[pair].sources.news = news;
        } catch (error) {
          logger.warn({ err: error, pair }, 'News analysis failed');
        }
      }
      
      // Economic Analysis
      if (this.economicAnalyzer) {
        try {
          const econ = await this.economicAnalyzer.analyzeEconomic(pair);
          analysis[pair].sources.economic = econ;
        } catch (error) {
          logger.warn({ err: error, pair }, 'Economic analysis failed');
        }
      }
      
      // RSS Signals (if available)
      if (this.rssSignalGenerator) {
        try {
          const rssSignals = await this.rssSignalGenerator.generateSignals({
            pairs: [pair],
            maxSignals: 1
          });
          if (rssSignals.length > 0) {
            analysis[pair].sources.rss = rssSignals[0];
          }
        } catch (error) {
          logger.warn({ err: error, pair }, 'RSS signal generation failed');
        }
      }
      
      // Consolidate into unified analysis
      analysis[pair].consolidated = this.consolidateAnalysis(analysis[pair].sources);
    }
    
    return analysis;
  }

  /**
   * Step 2: Generate candidate signals from analysis
   */
  async generateCandidateSignals(multiSourceAnalysis, pairs) {
    const candidates = [];
    
    for (const pair of pairs) {
      const analysis = multiSourceAnalysis[pair];
      if (!analysis) {continue;}
      
      const signal = this.createSignalFromAnalysis(analysis);
      if (signal) {
        candidates.push(signal);
      }
    }
    
    return candidates;
  }

  /**
   * Create signal from consolidated analysis
   */
  createSignalFromAnalysis(analysis) {
    const { consolidated, sources } = analysis;
    if (!consolidated || !consolidated.hasSignal) {
      return null;
    }
    
    // Calculate comprehensive metrics
    const strength = this.calculateSignalStrength(sources);
    const confidence = this.calculateSignalConfidence(sources);
    const finalScore = (strength + confidence) / 2;
    
    // Determine direction based on source agreement
    const direction = this.determineDirection(sources);
    if (!direction) {return null;}
    
    // Calculate entry, stop loss, and take profit
    const entry = this.calculateEntry(analysis.pair, direction, sources);
    const stopLoss = this.calculateStopLoss(entry, direction, sources);
    const takeProfit = this.calculateTakeProfit(entry, direction, sources);
    
    // Generate unique ID for tracking
    const signalId = `${analysis.pair}_${direction}_${Date.now()}`;
    
    return {
      id: signalId,
      pair: analysis.pair,
      direction,
      strength,
      confidence,
      finalScore,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio: this.calculateRR(entry, stopLoss, takeProfit),
      timestamp: Date.now(),
      sources: Object.keys(sources),
      sourceAgreement: this.calculateSourceAgreement(sources),
      reasoning: this.generateReasoning(sources, direction)
    };
  }

  /**
   * Step 3: Validate signals through standard validator
   */
  async validateSignals(candidateSignals, context) {
    const validated = [];
    
    for (const signal of candidateSignals) {
      // Ensure validation result is awaited if async
      let validationResult = this.validator.validate(signal, context);
      if (validationResult && typeof validationResult.then === 'function') {
        validationResult = await validationResult;
      }
      
      if (validationResult.valid) {
        validated.push({
          ...signal,
          validationScore: validationResult.score,
          validationChecks: validationResult.checks
        });
      } else {
        logger.debug({
          pair: signal.pair,
          reason: validationResult.reason
        }, 'Signal failed validation');
      }
    }
    
    return validated;
  }

  /**
   * Step 4: Apply ultra-quality filter
   */
  async applyUltraFilter(validatedSignals, multiSourceAnalysis, context) {
    if (!this.config.requireUltraFilter) {
      return validatedSignals;
    }
    
    const ultraSignals = [];
    
    for (const signal of validatedSignals) {
      const analysis = multiSourceAnalysis[signal.pair];
      const filterResult = await this.ultraFilter.filterSignal(signal, analysis.consolidated, context);
      
      if (filterResult.passed) {
        ultraSignals.push({
          ...signal,
          ...filterResult.enhancedSignal,
          ultraFilterResult: filterResult
        });
        
        logger.info({
          pair: signal.pair,
          winProbability: `${(filterResult.winProbability * 100).toFixed(1)}%`,
          confidence: filterResult.confidence.toFixed(1)
        }, 'Ultra-quality signal passed filter');
      }
    }
    
    return ultraSignals;
  }

  /**
   * Step 5: Apply risk management
   */
  async applyRiskManagement(ultraSignals, context) {
    const finalSignals = [];
    
    for (const signal of ultraSignals) {
      const positionSizing = this.riskManager.calculatePositionSize(signal, context);
      
      if (positionSizing.allowed) {
        finalSignals.push({
          ...signal,
          positionSize: positionSizing.positionSize,
          riskAmount: positionSizing.riskAmount,
          riskPercent: positionSizing.riskPercent,
          positionSizingDetails: positionSizing
        });
      } else {
        logger.debug({
          pair: signal.pair,
          reason: positionSizing.reason
        }, 'Signal rejected by risk manager');
      }
    }
    
    return finalSignals;
  }

  /**
   * Step 6: Rank and select top signals
   */
  rankAndSelectTopSignals(finalSignals) {
    // Sort by comprehensive score
    const ranked = finalSignals.sort((a, b) => {
      const scoreA = this.calculateComprehensiveScore(a);
      const scoreB = this.calculateComprehensiveScore(b);
      return scoreB - scoreA;
    });
    
    // Limit to max signals per hour
    const limit = this.config.maxSignalsPerHour;
    const topSignals = ranked.slice(0, limit);
    
    return topSignals;
  }

  /**
   * Calculate comprehensive score for ranking
   */
  calculateComprehensiveScore(signal) {
    const weights = {
      winProbability: 0.35,
      qualityScore: 0.25,
      riskReward: 0.20,
      sourceAgreement: 0.10,
      validationScore: 0.10
    };
    
    const normalized = {
      winProbability: (signal.winProbability || 0.5) * 100,
      qualityScore: signal.qualityScore || 50,
      riskReward: Math.min((signal.riskRewardRatio || 0) * 20, 100),
      sourceAgreement: (signal.sourceAgreement || 0.5) * 100,
      validationScore: signal.validationScore || 50
    };
    
    const score = Object.entries(weights).reduce((total, [key, weight]) => {
      return total + (normalized[key] * weight);
    }, 0);
    
    return score;
  }

  // ============ Helper Methods ============

  consolidateAnalysis(sources) {
    const signals = Object.values(sources).filter(s => s && (s.signal || s.direction));
    
    if (signals.length === 0) {
      return { hasSignal: false };
    }
    
    // Aggregate signals
    const buySignals = signals.filter(s => {
      const dir = s.signal?.direction || s.direction;
      return dir === 'BUY' || dir === 'bullish';
    }).length;
    
    const sellSignals = signals.filter(s => {
      const dir = s.signal?.direction || s.direction;
      return dir === 'SELL' || dir === 'bearish';
    }).length;
    
    const hasAgreement = (buySignals >= this.config.minSourceAgreement) || 
                         (sellSignals >= this.config.minSourceAgreement);
    
    return {
      hasSignal: hasAgreement,
      buySignals,
      sellSignals,
      direction: buySignals > sellSignals ? 'BUY' : 'SELL',
      agreement: Math.max(buySignals, sellSignals),
      totalSources: signals.length,
      technical: sources.technical,
      news: sources.news,
      economic: sources.economic,
      rss: sources.rss
    };
  }

  calculateSignalStrength(sources) {
    const strengths = [];
    
    if (sources.technical?.strength) {strengths.push(sources.technical.strength);}
    if (sources.news?.strength) {strengths.push(sources.news.strength);}
    if (sources.economic?.strength) {strengths.push(sources.economic.strength);}
    if (sources.rss?.strength) {strengths.push(sources.rss.strength);}
    
    if (strengths.length === 0) {return 50;}
    
    return strengths.reduce((sum, s) => sum + s, 0) / strengths.length;
  }

  calculateSignalConfidence(sources) {
    const confidences = [];
    
    if (sources.technical?.confidence) {confidences.push(sources.technical.confidence);}
    if (sources.news?.confidence) {confidences.push(sources.news.confidence);}
    if (sources.economic?.confidence) {confidences.push(sources.economic.confidence);}
    if (sources.rss?.confidence) {confidences.push(sources.rss.confidence);}
    
    if (confidences.length === 0) {return 50;}
    
    return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  }

  determineDirection(sources) {
    const directions = {};
    
    Object.values(sources).forEach(source => {
      const dir = source.signal?.direction || source.direction || source.trend;
      if (dir === 'BUY' || dir === 'bullish') {
        directions.BUY = (directions.BUY || 0) + 1;
      } else if (dir === 'SELL' || dir === 'bearish') {
        directions.SELL = (directions.SELL || 0) + 1;
      }
    });
    
    if (directions.BUY >= this.config.minSourceAgreement) {return 'BUY';}
    if (directions.SELL >= this.config.minSourceAgreement) {return 'SELL';}
    
    return null;
  }

  calculateEntry(pair, direction, sources) {
    // Get latest price from sources
    const prices = [];
    if (sources.technical?.latestPrice) {prices.push(sources.technical.latestPrice);}
    if (sources.rss?.entry?.price) {prices.push(sources.rss.entry.price);}
    
    const avgPrice = prices.length > 0 
      ? prices.reduce((sum, p) => sum + p, 0) / prices.length 
      : 1.0000;
    
    return { price: avgPrice, timestamp: Date.now() };
  }

  calculateStopLoss(entry, direction, sources) {
    // Calculate stop loss based on ATR or fixed pips
    const atr = sources.technical?.atr || 0.0020;
    const stopDistance = atr * 1.5; // 1.5x ATR
    
    if (direction === 'BUY') {
      return entry.price - stopDistance;
    } else {
      return entry.price + stopDistance;
    }
  }

  calculateTakeProfit(entry, direction, sources) {
    // Calculate take profit for min 2.5:1 R:R
    const atr = sources.technical?.atr || 0.0020;
    const tpDistance = atr * 3.75; // 2.5x the stop distance
    
    if (direction === 'BUY') {
      return entry.price + tpDistance;
    } else {
      return entry.price - tpDistance;
    }
  }

  calculateRR(entry, stopLoss, takeProfit) {
    const risk = Math.abs(entry.price - stopLoss);
    const reward = Math.abs(takeProfit - entry.price);
    return reward / risk;
  }

  calculateSourceAgreement(sources) {
    const total = Object.keys(sources).length;
    if (total === 0) {return 0;}
    
    const directions = {};
    Object.values(sources).forEach(source => {
      const dir = source.signal?.direction || source.direction || source.trend;
      if (dir) {
        directions[dir] = (directions[dir] || 0) + 1;
      }
    });
    
    const maxAgreement = Math.max(...Object.values(directions));
    return maxAgreement / total;
  }

  generateReasoning(sources, direction) {
    const reasons = [];
    
    if (sources.technical) {
      reasons.push(`Technical: ${sources.technical.trend || 'neutral'}`);
    }
    if (sources.news) {
      reasons.push(`News sentiment: ${sources.news.sentiment > 0 ? 'positive' : 'negative'}`);
    }
    if (sources.economic) {
      reasons.push(`Economic: ${sources.economic.outlook || 'mixed'}`);
    }
    if (sources.rss) {
      reasons.push(`RSS analysis confirms ${direction}`);
    }
    
    return reasons.join('; ');
  }

  recordSignals(signals) {
    signals.forEach(signal => {
      this.signalHistory.push({
        ...signal,
        recordedAt: Date.now()
      });
    });
    
    this.performanceMetrics.totalSignals += signals.length;
  }

  /**
   * Record signal outcome for performance tracking
   */
  recordOutcome(signalId, outcome) {
    const signal = this.signalHistory.find(s => s.id === signalId);
    if (!signal) {return;}
    
    signal.outcome = outcome;
    signal.closedAt = Date.now();
    
    if (outcome === 'win') {
      this.performanceMetrics.winningSignals++;
    } else {
      this.performanceMetrics.losingSignals++;
    }
    
    this.performanceMetrics.winRate = 
      this.performanceMetrics.winningSignals / 
      (this.performanceMetrics.winningSignals + this.performanceMetrics.losingSignals);
    
    // Pass outcome to ultra filter for learning
    this.ultraFilter.recordSignalOutcome(signal, outcome);
    
    logger.info({
      signalId,
      outcome,
      currentWinRate: `${(this.performanceMetrics.winRate * 100).toFixed(1)}%`
    }, 'Signal outcome recorded');
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      winRatePercent: `${(this.performanceMetrics.winRate * 100).toFixed(1)}%`,
      recentSignals: this.signalHistory.slice(-20)
    };
  }
}

export default IntegratedSignalPipeline;
