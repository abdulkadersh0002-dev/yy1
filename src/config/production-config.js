/**
 * Production Configuration Management
 * All strategies, risk rules, and parameters configurable without code changes
 */

/**
 * Strategy Configuration
 */
export const strategies = {
  // AI/Deep Learning Strategy
  ai_strategy: {
    enabled: true,
    minConfidence: 0.85,
    minQuality: 85,
    weight: 0.35
  },

  // Technical Analysis Strategy
  technical_strategy: {
    enabled: true,
    indicators: {
      rsi: { enabled: true, oversold: 30, overbought: 70 },
      macd: { enabled: true, signalCrossover: true },
      movingAverage: { enabled: true, periods: [50, 200] },
      fibonacci: { enabled: true }
    },
    weight: 0.25
  },

  // News/Sentiment Strategy
  news_strategy: {
    enabled: true,
    minSentimentScore: 0.6,
    highImpactOnly: true,
    weight: 0.20
  },

  // Ensemble Strategy
  ensemble_strategy: {
    enabled: true,
    minAgreement: 4,  // At least 4 out of 6 models must agree
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
 */
export const signalValidation = {
  minQuality: 75,
  minConfidence: 0.70,
  minRiskReward: 1.5,
  maxSpread: 3,  // pips
  
  // Ultra filter stages
  stages: {
    priceAction: { enabled: true, weight: 0.15 },
    multiTimeframe: { enabled: true, weight: 0.15 },
    volumeProfile: { enabled: true, weight: 0.10 },
    marketStructure: { enabled: true, weight: 0.15 },
    advancedFilters: { enabled: true, weight: 0.15 }
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
