/**
 * News Classification Service
 * Intelligent news analysis and classification
 * Provides smart actions based on news type, impact, and timing
 */

import logger from '../logging/logger.js';

class NewsClassificationService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    
    // News type patterns
    this.newsTypes = {
      'INTEREST_RATE': {
        keywords: ['interest rate', 'fed funds', 'monetary policy', 'rate decision', 'policy rate'],
        impact: 'high',
        volatilityMultiplier: 3.0,
        actions: ['widen_sl', 'reduce_size', 'prevent_entry']
      },
      'CPI': {
        keywords: ['cpi', 'consumer price', 'inflation rate', 'price index'],
        impact: 'high',
        volatilityMultiplier: 2.5,
        actions: ['widen_sl', 'prevent_entry']
      },
      'NFP': {
        keywords: ['non-farm', 'nonfarm', 'payroll', 'employment change', 'jobs report'],
        impact: 'high',
        volatilityMultiplier: 2.8,
        actions: ['partial_close', 'widen_sl', 'prevent_entry']
      },
      'GDP': {
        keywords: ['gdp', 'gross domestic product', 'economic growth'],
        impact: 'high',
        volatilityMultiplier: 2.2,
        actions: ['widen_sl', 'prevent_entry']
      },
      'PMI': {
        keywords: ['pmi', 'purchasing managers', 'manufacturing index'],
        impact: 'medium',
        volatilityMultiplier: 1.5,
        actions: ['monitor']
      },
      'RETAIL_SALES': {
        keywords: ['retail sales', 'consumer spending'],
        impact: 'medium',
        volatilityMultiplier: 1.6,
        actions: ['monitor', 'widen_sl']
      },
      'UNEMPLOYMENT': {
        keywords: ['unemployment', 'jobless', 'claims'],
        impact: 'medium',
        volatilityMultiplier: 1.8,
        actions: ['widen_sl', 'prevent_entry']
      },
      'TRADE_BALANCE': {
        keywords: ['trade balance', 'exports', 'imports', 'current account'],
        impact: 'low',
        volatilityMultiplier: 1.2,
        actions: ['monitor']
      },
      'SPEECHES': {
        keywords: ['speech', 'testimony', 'press conference', 'remarks'],
        impact: 'medium',
        volatilityMultiplier: 1.4,
        actions: ['monitor']
      },
      'GENERAL': {
        keywords: [],
        impact: 'low',
        volatilityMultiplier: 1.0,
        actions: ['monitor']
      }
    };
    
    // Historical behavior tracking
    this.historicalBehavior = new Map(); // newsType -> { avgMove, avgDuration, pattern }
    
    // Timing windows (milliseconds)
    this.timingWindows = {
      imminent: 15 * 60 * 1000,    // 15 minutes before
      during: 30 * 60 * 1000,       // 30 minutes after
      aftermath: 60 * 60 * 1000     // 1 hour after
    };
  }

  /**
   * Classify news item
   * Returns: { type, impact, level, timing, actions, volatilityMultiplier }
   */
  classifyNews(newsItem) {
    const title = (newsItem.title || newsItem.headline || '').toLowerCase();
    const impact = newsItem.impact || 0;
    const timestamp = newsItem.time || newsItem.timestamp || Date.now();
    
    // Detect news type
    const newsType = this.detectNewsType(title);
    const typeInfo = this.newsTypes[newsType] || this.newsTypes.GENERAL;
    
    // Classify impact level
    const impactLevel = this.classifyImpactLevel(impact, typeInfo.impact);
    
    // Determine timing
    const timing = this.determineTiming(timestamp);
    
    // Get recommended actions
    const actions = this.getSmartActions(newsType, impactLevel, timing, newsItem);
    
    return {
      type: newsType,
      impact: typeInfo.impact,
      level: impactLevel,
      timing: timing,
      actions: actions,
      volatilityMultiplier: typeInfo.volatilityMultiplier,
      timestamp: timestamp,
      originalImpact: impact
    };
  }

  /**
   * Detect news type from title
   */
  detectNewsType(title) {
    for (const [type, config] of Object.entries(this.newsTypes)) {
      if (type === 'GENERAL') {
        continue;
      }
      
      for (const keyword of config.keywords) {
        if (title.includes(keyword)) {
          return type;
        }
      }
    }
    
    return 'GENERAL';
  }

  /**
   * Classify impact level (high/medium/low)
   */
  classifyImpactLevel(numericImpact, baseImpact) {
    // If we have numeric impact, use it
    if (numericImpact >= 70) {
      return 'high';
    } else if (numericImpact >= 40) {
      return 'medium';
    } else if (numericImpact > 0) {
      return 'low';
    }
    
    // Otherwise use base impact from news type
    return baseImpact || 'low';
  }

  /**
   * Determine timing relative to current time
   */
  determineTiming(newsTimestamp) {
    const now = Date.now();
    const diff = newsTimestamp - now;
    
    if (diff > 0 && diff <= this.timingWindows.imminent) {
      return 'imminent'; // News coming soon
    } else if (diff > -this.timingWindows.during && diff <= 0) {
      return 'during'; // News just happened
    } else if (diff > -this.timingWindows.aftermath && diff <= -this.timingWindows.during) {
      return 'aftermath'; // Recent news
    } else if (diff > 0) {
      return 'scheduled'; // Future news
    }
    
    return 'past'; // Old news
  }

  /**
   * Get smart actions based on news classification
   */
  getSmartActions(newsType, impactLevel, timing, newsItem) {
    const baseActions = this.newsTypes[newsType]?.actions || ['monitor'];
    const actions = [];
    
    // Timing-based actions
    if (timing === 'imminent') {
      if (impactLevel === 'high') {
        actions.push({
          action: 'PREVENT_ENTRY',
          reason: `High-impact ${newsType} imminent`,
          priority: 'HIGH'
        });
        actions.push({
          action: 'REDUCE_SIZE',
          adjustment: 0.5, // 50% reduction
          reason: `Reduce exposure before ${newsType}`,
          priority: 'MEDIUM'
        });
      } else if (impactLevel === 'medium') {
        actions.push({
          action: 'WIDEN_SL',
          adjustment: 1.5, // 50% wider
          reason: `Widen stop-loss before ${newsType}`,
          priority: 'MEDIUM'
        });
      }
    } else if (timing === 'during') {
      if (impactLevel === 'high') {
        actions.push({
          action: 'PREVENT_ENTRY',
          reason: `High-impact ${newsType} in progress`,
          priority: 'HIGH'
        });
        
        // Check if we should exit existing positions
        if (newsType === 'NFP' || newsType === 'INTEREST_RATE') {
          actions.push({
            action: 'PARTIAL_CLOSE',
            percentage: 50,
            reason: `Partial exit during ${newsType}`,
            priority: 'HIGH'
          });
        } else {
          actions.push({
            action: 'WIDEN_SL',
            adjustment: 2.0, // Double the SL
            reason: `Widen stop-loss during ${newsType}`,
            priority: 'HIGH'
          });
        }
      }
    } else if (timing === 'aftermath') {
      if (impactLevel === 'high') {
        actions.push({
          action: 'MONITOR',
          reason: `Watch for ${newsType} aftermath volatility`,
          priority: 'LOW'
        });
      }
    }
    
    // If no specific actions, default to monitor
    if (actions.length === 0) {
      actions.push({
        action: 'MONITOR',
        reason: `Track ${newsType} impact`,
        priority: 'LOW'
      });
    }
    
    return actions;
  }

  /**
   * Record historical behavior for learning
   */
  recordHistoricalBehavior(newsType, behavior) {
    if (!this.historicalBehavior.has(newsType)) {
      this.historicalBehavior.set(newsType, {
        samples: [],
        avgMove: 0,
        avgDuration: 0,
        pattern: 'unknown'
      });
    }
    
    const history = this.historicalBehavior.get(newsType);
    history.samples.push(behavior);
    
    // Keep last 50 samples
    if (history.samples.length > 50) {
      history.samples.shift();
    }
    
    // Recalculate averages
    const moves = history.samples.map(s => s.move || 0);
    const durations = history.samples.map(s => s.duration || 0);
    
    history.avgMove = moves.reduce((a, b) => a + b, 0) / moves.length;
    history.avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    
    // Determine pattern
    const upMoves = moves.filter(m => m > 0).length;
    const downMoves = moves.filter(m => m < 0).length;
    
    if (upMoves > downMoves * 1.5) {
      history.pattern = 'bullish';
    } else if (downMoves > upMoves * 1.5) {
      history.pattern = 'bearish';
    } else {
      history.pattern = 'neutral';
    }
  }

  /**
   * Get historical behavior for a news type
   */
  getHistoricalBehavior(newsType) {
    return this.historicalBehavior.get(newsType) || null;
  }

  /**
   * Evaluate news impact for a specific trade
   */
  evaluateNewsImpact(newsItem, trade) {
    const classification = this.classifyNews(newsItem);
    const { type, level, timing, actions, volatilityMultiplier } = classification;
    
    // Get historical behavior if available
    const historical = this.getHistoricalBehavior(type);
    
    // Determine if trade should be affected
    const currencies = this.extractCurrencies(trade.symbol);
    const newsCurrency = newsItem.currency;
    
    let affectsTrade = false;
    if (newsCurrency && currencies.includes(newsCurrency)) {
      affectsTrade = true;
    }
    
    return {
      classification,
      affectsTrade,
      historical,
      recommendedActions: affectsTrade ? actions : [],
      riskMultiplier: affectsTrade ? volatilityMultiplier : 1.0
    };
  }

  /**
   * Extract currencies from symbol
   */
  extractCurrencies(symbol) {
    const clean = symbol.replace(/[^A-Z]/g, '');
    if (clean.length >= 6) {
      return [clean.substring(0, 3), clean.substring(3, 6)];
    }
    return [];
  }

  /**
   * Get aggregated news impact for multiple news items
   */
  aggregateNewsImpact(newsItems, symbol) {
    let highestLevel = 'low';
    let mostUrgentTiming = 'past';
    const allActions = [];
    let maxVolatilityMultiplier = 1.0;
    
    const timingPriority = {
      'during': 4,
      'imminent': 3,
      'aftermath': 2,
      'scheduled': 1,
      'past': 0
    };
    
    for (const newsItem of newsItems) {
      const classification = this.classifyNews(newsItem);
      
      // Check if affects this symbol
      const currencies = this.extractCurrencies(symbol);
      const affectsTrade = newsItem.currency && currencies.includes(newsItem.currency);
      
      if (!affectsTrade) {
        continue;
      }
      
      // Update highest level
      if (classification.level === 'high' || 
          (classification.level === 'medium' && highestLevel === 'low')) {
        highestLevel = classification.level;
      }
      
      // Update most urgent timing
      const currentPriority = timingPriority[mostUrgentTiming] || 0;
      const newPriority = timingPriority[classification.timing] || 0;
      if (newPriority > currentPriority) {
        mostUrgentTiming = classification.timing;
      }
      
      // Collect actions
      allActions.push(...classification.actions);
      
      // Track max volatility
      if (classification.volatilityMultiplier > maxVolatilityMultiplier) {
        maxVolatilityMultiplier = classification.volatilityMultiplier;
      }
    }
    
    // Deduplicate and prioritize actions
    const uniqueActions = this.prioritizeActions(allActions);
    
    return {
      level: highestLevel,
      timing: mostUrgentTiming,
      actions: uniqueActions,
      volatilityMultiplier: maxVolatilityMultiplier,
      count: newsItems.length
    };
  }

  /**
   * Prioritize and deduplicate actions
   */
  prioritizeActions(actions) {
    const actionMap = new Map();
    const priorities = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    
    for (const action of actions) {
      const key = action.action;
      const existing = actionMap.get(key);
      
      if (!existing || priorities[action.priority] > priorities[existing.priority]) {
        actionMap.set(key, action);
      }
    }
    
    return Array.from(actionMap.values()).sort((a, b) => 
      priorities[b.priority] - priorities[a.priority]
    );
  }
}

export default NewsClassificationService;
