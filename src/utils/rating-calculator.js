/**
 * Rating Calculator
 * Calculate comprehensive ratings for the application and trading signals
 */

/**
 * Calculate overall application health and performance rating (0-100)
 * @param {Object} metrics - Application metrics
 * @returns {Object} Application rating with breakdown
 */
export function calculateAppRating(metrics = {}) {
  const {
    systemHealth = {},
    performanceMetrics = {},
    tradingStats = {},
    dataQuality = {},
    uptime = 100
  } = metrics;

  const ratings = {
    systemHealth: calculateSystemHealthRating(systemHealth),
    performance: calculatePerformanceRating(performanceMetrics),
    tradingQuality: calculateTradingQualityRating(tradingStats),
    dataQuality: calculateDataQualityRating(dataQuality),
    uptime: Math.min(100, uptime)
  };

  // Weighted average for overall app rating
  const weights = {
    systemHealth: 0.25,
    performance: 0.25,
    tradingQuality: 0.3,
    dataQuality: 0.15,
    uptime: 0.05
  };

  const overallRating = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + (ratings[key] || 0) * weight;
  }, 0);

  return {
    overallRating: Math.round(overallRating * 10) / 10,
    breakdown: ratings,
    grade: getRatingGrade(overallRating),
    status: getRatingStatus(overallRating)
  };
}

/**
 * Calculate signal quality rating (0-100)
 * @param {Object} signal - Trading signal
 * @param {Object} validationResult - Signal validation result
 * @returns {Object} Signal rating with breakdown
 */
export function calculateSignalRating(signal, validationResult = null) {
  const ratings = {
    strength: Math.min(100, signal.strength || 0),
    confidence: Math.min(100, signal.confidence || 0),
    finalScore: normalizeScore(signal.finalScore || 0, -100, 100),
    validationScore: validationResult ? validationResult.score : 0,
    riskReward: calculateRiskRewardRating(signal),
    freshness: calculateFreshnessRating(signal),
    completeness: calculateCompletenessRating(signal)
  };

  // Weighted average for overall signal rating
  const weights = {
    strength: 0.2,
    confidence: 0.25,
    finalScore: 0.15,
    validationScore: 0.2,
    riskReward: 0.1,
    freshness: 0.05,
    completeness: 0.05
  };

  const overallRating = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + (ratings[key] || 0) * weight;
  }, 0);

  return {
    overallRating: Math.round(overallRating * 10) / 10,
    breakdown: ratings,
    grade: getRatingGrade(overallRating),
    status: getRatingStatus(overallRating),
    recommendation: getSignalRecommendation(overallRating, signal)
  };
}

/**
 * Calculate system health rating
 * @param {Object} health - System health data
 * @returns {number} Rating 0-100
 */
function calculateSystemHealthRating(health) {
  const {
    servicesUp = 0,
    servicesTotal = 1,
    providersAvailable = 0,
    providersTotal = 1,
    errorRate = 0
  } = health;

  const serviceHealth = (servicesUp / servicesTotal) * 100;
  const providerHealth = (providersAvailable / providersTotal) * 100;
  const errorHealth = Math.max(0, 100 - errorRate * 100);

  return serviceHealth * 0.4 + providerHealth * 0.4 + errorHealth * 0.2;
}

/**
 * Calculate performance rating
 * @param {Object} metrics - Performance metrics
 * @returns {number} Rating 0-100
 */
function calculatePerformanceRating(metrics) {
  const {
    winRate = 0,
    profitFactor = 0,
    sharpeRatio = 0,
    maxDrawdownPct = 0,
    avgReturnPct = 0
  } = metrics;

  // Normalize metrics to 0-100 scale
  const winRateScore = winRate * 100;
  const profitFactorScore = Math.min(100, (profitFactor / 3) * 100);
  const sharpeScore = Math.min(100, Math.max(0, ((sharpeRatio + 1) / 4) * 100));
  const drawdownScore = Math.max(0, 100 - Math.abs(maxDrawdownPct) * 2);
  const returnScore = Math.min(100, Math.max(0, (avgReturnPct + 5) * 10));

  return (
    winRateScore * 0.25 +
    profitFactorScore * 0.25 +
    sharpeScore * 0.2 +
    drawdownScore * 0.15 +
    returnScore * 0.15
  );
}

/**
 * Calculate trading quality rating
 * @param {Object} stats - Trading statistics
 * @returns {number} Rating 0-100
 */
function calculateTradingQualityRating(stats) {
  const {
    totalTrades = 0,
    validSignalsRatio = 0,
    avgTradeQuality = 0,
    riskManagementScore = 0
  } = stats;

  // More trades generally indicate more experience/data
  const tradeVolumeScore = Math.min(100, (totalTrades / 100) * 100);
  const signalQualityScore = validSignalsRatio * 100;
  const tradeQualityScore = avgTradeQuality;
  const riskScore = riskManagementScore;

  return (
    tradeVolumeScore * 0.1 + signalQualityScore * 0.3 + tradeQualityScore * 0.35 + riskScore * 0.25
  );
}

/**
 * Calculate data quality rating
 * @param {Object} quality - Data quality metrics
 * @returns {number} Rating 0-100
 */
function calculateDataQualityRating(quality) {
  const { completeness = 0, accuracy = 0, timeliness = 0, consistency = 0 } = quality;

  return (completeness * 0.25 + accuracy * 0.35 + timeliness * 0.25 + consistency * 0.15) * 100;
}

/**
 * Calculate risk-reward rating for a signal
 * @param {Object} signal - Trading signal
 * @returns {number} Rating 0-100
 */
function calculateRiskRewardRating(signal) {
  if (!signal.entry || !signal.entry.price || !signal.entry.stopLoss || !signal.entry.takeProfit) {
    return 0;
  }

  const { price, stopLoss, takeProfit } = signal.entry;
  const direction = signal.direction;

  let rrRatio = 0;
  if (direction === 'BUY') {
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(takeProfit - price);
    rrRatio = risk > 0 ? reward / risk : 0;
  } else if (direction === 'SELL') {
    const risk = Math.abs(stopLoss - price);
    const reward = Math.abs(price - takeProfit);
    rrRatio = risk > 0 ? reward / risk : 0;
  }

  // Rate R:R ratio (1.5 = 50%, 2.0 = 66%, 3.0 = 85%, 4.0+ = 100%)
  if (rrRatio >= 4) return 100;
  if (rrRatio >= 3) return 85;
  if (rrRatio >= 2) return 66;
  if (rrRatio >= 1.5) return 50;
  return Math.max(0, (rrRatio / 1.5) * 50);
}

/**
 * Calculate freshness rating for a signal
 * @param {Object} signal - Trading signal
 * @returns {number} Rating 0-100
 */
function calculateFreshnessRating(signal) {
  if (!signal.timestamp) return 50;

  const age = Date.now() - signal.timestamp;
  const ageMinutes = age / (1000 * 60);

  // Fresh signal (< 1 min) = 100%
  // 5 minutes = 80%
  // 10 minutes = 50%
  // 30+ minutes = 0%
  if (ageMinutes < 1) return 100;
  if (ageMinutes < 5) return 100 - (ageMinutes - 1) * 5;
  if (ageMinutes < 10) return 80 - (ageMinutes - 5) * 6;
  if (ageMinutes < 30) return 50 - (ageMinutes - 10) * 2.5;
  return 0;
}

/**
 * Calculate completeness rating for a signal
 * @param {Object} signal - Trading signal
 * @returns {number} Rating 0-100
 */
function calculateCompletenessRating(signal) {
  let score = 0;
  let maxScore = 0;

  // Required fields
  const required = ['pair', 'direction', 'strength', 'confidence', 'finalScore'];
  required.forEach((field) => {
    maxScore += 15;
    if (signal[field] !== undefined && signal[field] !== null) score += 15;
  });

  // Entry data
  maxScore += 15;
  if (signal.entry && signal.entry.price && signal.entry.stopLoss && signal.entry.takeProfit) {
    score += 15;
  }

  // Risk management
  maxScore += 10;
  if (signal.riskManagement && Object.keys(signal.riskManagement).length > 0) {
    score += 10;
  }

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

/**
 * Normalize a score from one range to 0-100
 * @param {number} value - Value to normalize
 * @param {number} min - Minimum value in range
 * @param {number} max - Maximum value in range
 * @returns {number} Normalized score 0-100
 */
function normalizeScore(value, min, max) {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * Get letter grade for rating
 * @param {number} rating - Rating 0-100
 * @returns {string} Letter grade
 */
function getRatingGrade(rating) {
  if (rating >= 90) return 'A+';
  if (rating >= 85) return 'A';
  if (rating >= 80) return 'A-';
  if (rating >= 75) return 'B+';
  if (rating >= 70) return 'B';
  if (rating >= 65) return 'B-';
  if (rating >= 60) return 'C+';
  if (rating >= 55) return 'C';
  if (rating >= 50) return 'C-';
  if (rating >= 45) return 'D+';
  if (rating >= 40) return 'D';
  return 'F';
}

/**
 * Get status for rating
 * @param {number} rating - Rating 0-100
 * @returns {string} Status
 */
function getRatingStatus(rating) {
  if (rating >= 90) return 'Excellent';
  if (rating >= 80) return 'Very Good';
  if (rating >= 70) return 'Good';
  if (rating >= 60) return 'Fair';
  if (rating >= 50) return 'Average';
  if (rating >= 40) return 'Below Average';
  return 'Poor';
}

/**
 * Get trading recommendation for signal
 * @param {number} rating - Signal rating
 * @param {Object} signal - Trading signal
 * @returns {string} Recommendation
 */
function getSignalRecommendation(rating, signal) {
  if (rating >= 80) {
    return 'STRONG ' + signal.direction;
  }
  if (rating >= 70) {
    return 'MODERATE ' + signal.direction;
  }
  if (rating >= 60) {
    return 'WEAK ' + signal.direction;
  }
  if (rating >= 50) {
    return 'CONSIDER ' + signal.direction;
  }
  return 'AVOID';
}

/**
 * Format rating for display
 * @param {Object} rating - Rating object
 * @returns {string} Formatted rating
 */
export function formatRating(rating) {
  return `Rating: ${rating.overallRating.toFixed(1)}/100 (${rating.grade}) - ${rating.status}`;
}

/**
 * Get detailed rating report
 * @param {Object} rating - Rating object
 * @returns {string} Detailed report
 */
export function getDetailedRatingReport(rating) {
  let report = `Overall Rating: ${rating.overallRating.toFixed(1)}/100 (${rating.grade}) - ${rating.status}\n\n`;
  report += 'Breakdown:\n';

  Object.entries(rating.breakdown).forEach(([key, value]) => {
    const formattedKey = key.replace(/([A-Z])/g, ' $1').trim();
    const capitalizedKey = formattedKey.charAt(0).toUpperCase() + formattedKey.slice(1);
    report += `  ${capitalizedKey}: ${value.toFixed(1)}/100\n`;
  });

  if (rating.recommendation) {
    report += `\nRecommendation: ${rating.recommendation}`;
  }

  return report;
}

export default {
  calculateAppRating,
  calculateSignalRating,
  formatRating,
  getDetailedRatingReport
};
