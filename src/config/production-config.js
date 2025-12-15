/**
 * Production Configuration Management
 * All strategies, risk rules, and parameters configurable without code changes
 */

/**
 * Strategy Configuration
 * Ultra-Quality Settings for 90-100% Win Rate
 */
export const strategies = {
  // AI/Deep Learning Strategy
  ai_strategy: {
    enabled: true,
    minConfidence: 0.90,          // Raised from 0.85 for ultra-quality
    minQuality: 90,                // Raised from 85
    modelAgreementRequired: 5,     // Require 5/6 models (83% consensus)
    weight: 0.35
  },

  // Technical Analysis Strategy
  technical_strategy: {
    enabled: true,
    minConfluence: 5,              // Require 5+ indicator confirmations
    multiTimeframeRequired: true,  // All timeframes must align
    indicators: {
      rsi: { enabled: true, oversold: 30, overbought: 70, requireDivergenceCheck: true },
      macd: { enabled: true, signalCrossover: true, requireHistogramExpansion: true },
      movingAverage: { enabled: true, periods: [50, 200], requireAllAligned: true },
      fibonacci: { enabled: true, requireLevelConfluence: true },
      adx: { enabled: true, minStrength: 25 },  // Only strong trends
      atr: { enabled: true, maxVolatility: 2.0 } // Avoid extreme volatility
    },
    weight: 0.25
  },

  // News/Sentiment Strategy
  news_strategy: {
    enabled: true,
    minSentimentScore: 0.75,       // Raised from 0.6
    highImpactOnly: true,
    requireNoConflict: true,       // No conflicting news within 30min
    weight: 0.20
  },

  // Ensemble Strategy (6 ML models)
  ensemble_strategy: {
    enabled: true,
    minAgreement: 5,               // Raised from 4 - require 5/6 models (83%)
    minEnsembleConfidence: 0.85,   // Overall ensemble must be 85%+ confident
    models: {
      lstm: { enabled: true, weight: 0.20, minAccuracy: 0.87 },
      gru: { enabled: true, weight: 0.18, minAccuracy: 0.85 },
      cnn: { enabled: true, weight: 0.17, minAccuracy: 0.82 },
      randomForest: { enabled: true, weight: 0.15, minAccuracy: 0.80 },
      xgboost: { enabled: true, weight: 0.15, minAccuracy: 0.83 },
      lightgbm: { enabled: true, weight: 0.15, minAccuracy: 0.82 }
    },
    weight: 0.20
  }
};

/**
 * Risk Management Configuration
 */
export const riskConfig = {
  // Position sizing
  maxRiskPerTrade: 0.02,      // 2%
  fractionalKelly: 0.25,       // 25% of Kelly
  maxPositionSize: 1.0,        // 1.0 lot

  // Daily/weekly limits
  maxDailyLoss: 0.05,          // 5%
  maxWeeklyLoss: 0.10,         // 10%
  maxDailyTrades: 10,

  // Consecutive loss protection
  maxConsecutiveLosses: 3,
  cooldownMinutes: 60,

  // Session limits
  maxRiskPerSession: 0.03,     // 3%
  sessions: {
    LONDON: { enabled: true, maxTrades: 4 },
    NEW_YORK: { enabled: true, maxTrades: 4 },
    TOKYO: { enabled: true, maxTrades: 2 },
    SYDNEY: { enabled: false, maxTrades: 0 }
  }
};

/**
 * Signal Validation Configuration
 * Ultra-Strict Filtering for 90-100% Win Rate
 */
export const signalValidation = {
  // Core Quality Thresholds (Ultra-Strict)
  minQuality: 85,                  // Raised from 75 - institutional grade only
  minConfidence: 0.85,             // Raised from 0.70 - high confidence required
  minFinalScore: 80,               // Overall signal score threshold
  minRiskReward: 2.5,              // Raised from 1.5 - better risk/reward
  minWinProbability: 0.90,         // Target 90%+ win rate
  maxSpread: 2.5,                  // Reduced from 3 - tighter spreads only
  
  // Multi-Timeframe Confluence (All must align)
  timeframes: {
    D1: { enabled: true, weight: 0.25, trendMustAlign: true },
    H4: { enabled: true, weight: 0.25, trendMustAlign: true },
    H1: { enabled: true, weight: 0.25, trendMustAlign: true },
    M15: { enabled: true, weight: 0.25, trendMustAlign: true }
  },
  
  // Ultra filter stages (7-stage system)
  stages: {
    stage1_basicQuality: { 
      enabled: true, 
      weight: 0.15,
      checks: ['strength', 'confidence', 'score', 'riskReward']
    },
    stage2_marketRegime: { 
      enabled: true, 
      weight: 0.15,
      allowedRegimes: ['trending_strong', 'breakout'],
      requireOptimalConditions: true
    },
    stage3_technicalConfluence: { 
      enabled: true, 
      weight: 0.20,
      minConfluence: 5,
      requireMultiTimeframe: true
    },
    stage4_riskRewardProfile: { 
      enabled: true, 
      weight: 0.15,
      minRR: 2.5,
      requireMultiLevelTP: true
    },
    stage5_aiEnsemble: {
      enabled: true,
      weight: 0.15,
      minModelAgreement: 5,
      minEnsembleConfidence: 0.85
    },
    stage6_newsAlignment: {
      enabled: true,
      weight: 0.10,
      requireNoConflict: true,
      checkWindow: 30  // minutes
    },
    stage7_historicalValidation: {
      enabled: true,
      weight: 0.10,
      minHistoricalWinRate: 0.70,
      minSimilarPatterns: 3,
      minSimilarityScore: 0.85
    }
  }
};

/**
 * News Filter Configuration
 */
export const newsFilter = {
  enabled: true,
  avoidBeforeMinutes: 15,
  avoidAfterMinutes: 30,
  highImpactOnly: true,
  
  // News sources
  sources: {
    rss: { enabled: true, weight: 0.4 },
    economic_calendar: { enabled: true, weight: 0.4 },
    sentiment: { enabled: true, weight: 0.2 }
  }
};

/**
 * Auto-Trader Configuration
 */
export const autoTrader = {
  enabled: false,  // Requires explicit enablement
  
  // Trade management
  breakEven: {
    enabled: true,
    triggerPips: 15,
    moveToPips: 1
  },
  
  partialClose: {
    enabled: true,
    triggerPips: 25,
    closePercent: 0.5
  },
  
  trailing: {
    enabled: true,
    startPips: 30,
    stepPips: 5
  },

  // Safety
  maxSimultaneousTrades: 3,
  requireSessionMatch: true,
  avoidNews: true
};

/**
 * Data Source Configuration
 */
export const dataSources = {
  mt4ea: {
    enabled: true,
    endpoint: 'http://127.0.0.1:5002/api/ea/price-update',
    maxAge: 20000,  // 20 seconds
    requiredFields: ['pair', 'bid', 'ask', 'timestamp']
  },

  rss: {
    enabled: true,
    maxAge: 300000,  // 5 minutes
    minArticles: 1,
    sources: 19
  },

  twelveData: {
    enabled: true,
    maxAge: 60000,  // 1 minute
    rateLimitPerMin: 55,  // Under 55 to be safe
    retryAttempts: 3
  },

  websocket: {
    enabled: true,
    heartbeatInterval: 30000,  // 30 seconds
    reconnectDelay: 5000,
    maxReconnectAttempts: 5
  }
};

/**
 * Monitoring & Alerting Configuration
 */
export const monitoring = {
  metrics: {
    enabled: true,
    collectInterval: 60000,  // 1 minute
    retentionDays: 30
  },

  alerts: {
    enabled: true,
    channels: {
      log: true,
      email: false,  // Configure SMTP first
      telegram: false,  // Configure bot first
      webhook: false  // Configure URL first
    },
    
    // Alert thresholds
    thresholds: {
      staleData: 60000,  // 60 seconds
      highLatency: 5000,  // 5 seconds
      lowSuccessRate: 0.90,  // 90%
      highRejectionRate: 0.30  // 30%
    }
  }
};

/**
 * Stress Test Configuration
 */
export const stressTest = {
  scenarios: {
    dataOutage: {
      enabled: false,
      duration: 300000  // 5 minutes
    },
    
    highVolatility: {
      enabled: false,
      spreadMultiplier: 3
    },
    
    newsOverlap: {
      enabled: false,
      simultaneousEvents: 3
    },
    
    apiFailure: {
      enabled: false,
      failureRate: 0.5  // 50%
    }
  }
};

/**
 * Get configuration value safely
 */
export function getConfig(path, defaultValue = null) {
  const keys = path.split('.');
  let value = { 
    strategies, 
    riskConfig, 
    signalValidation, 
    newsFilter, 
    autoTrader, 
    dataSources, 
    monitoring, 
    stressTest 
  };
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  
  return value;
}

/**
 * Update configuration value
 */
export function updateConfig(path, newValue) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  
  let target = { 
    strategies, 
    riskConfig, 
    signalValidation, 
    newsFilter, 
    autoTrader, 
    dataSources, 
    monitoring, 
    stressTest 
  };
  
  for (const key of keys) {
    if (!(key in target)) {
      target[key] = {};
    }
    target = target[key];
  }
  
  target[lastKey] = newValue;
  
  return true;
}

/**
 * Export all configs
 */
export default {
  strategies,
  riskConfig,
  signalValidation,
  newsFilter,
  autoTrader,
  dataSources,
  monitoring,
  stressTest,
  getConfig,
  updateConfig
};
