#!/usr/bin/env node
/**
 * Show Application and Signal Ratings
 * Display comprehensive ratings for the trading system
 */

import {
  calculateAppRating,
  calculateSignalRating,
  getDetailedRatingReport
} from '../src/utils/rating-calculator.js';

/**
 * Display application rating
 */
function displayAppRating() {
  console.log('\n' + '='.repeat(60));
  console.log('APPLICATION RATING');
  console.log('='.repeat(60) + '\n');

  // Sample metrics - in production, these would come from actual system
  const metrics = {
    systemHealth: {
      servicesUp: 18,
      servicesTotal: 20,
      providersAvailable: 4,
      providersTotal: 5,
      errorRate: 0.02
    },
    performanceMetrics: {
      winRate: 0.58,
      profitFactor: 1.85,
      sharpeRatio: 1.2,
      maxDrawdownPct: 8.5,
      avgReturnPct: 1.2
    },
    tradingStats: {
      totalTrades: 156,
      validSignalsRatio: 0.82,
      avgTradeQuality: 75,
      riskManagementScore: 88
    },
    dataQuality: {
      completeness: 0.95,
      accuracy: 0.92,
      timeliness: 0.88,
      consistency: 0.9
    },
    uptime: 99.8
  };

  const appRating = calculateAppRating(metrics);
  console.log(getDetailedRatingReport(appRating));
  console.log('\n' + '='.repeat(60) + '\n');

  return appRating;
}

/**
 * Display signal rating examples
 */
function displaySignalRatings() {
  console.log('='.repeat(60));
  console.log('SIGNAL RATING EXAMPLES');
  console.log('='.repeat(60) + '\n');

  // Example signals with different quality levels
  const signals = [
    {
      name: 'High Quality Signal',
      signal: {
        pair: 'EURUSD',
        timestamp: Date.now(),
        direction: 'BUY',
        strength: 85,
        confidence: 88,
        finalScore: 86,
        entry: {
          price: 1.1,
          stopLoss: 1.095,
          takeProfit: 1.115
        },
        riskManagement: {
          positionSize: 10000,
          riskAmount: 50,
          accountRiskPercentage: 2
        },
        isValid: { isValid: true, checks: {}, reason: 'Valid' }
      },
      validation: { score: 92 }
    },
    {
      name: 'Medium Quality Signal',
      signal: {
        pair: 'GBPUSD',
        timestamp: Date.now() - 180000, // 3 minutes old
        direction: 'SELL',
        strength: 65,
        confidence: 68,
        finalScore: 45,
        entry: {
          price: 1.25,
          stopLoss: 1.255,
          takeProfit: 1.24
        },
        riskManagement: {
          positionSize: 8000
        },
        isValid: { isValid: true, checks: {}, reason: 'Valid' }
      },
      validation: { score: 72 }
    },
    {
      name: 'Low Quality Signal',
      signal: {
        pair: 'USDJPY',
        timestamp: Date.now() - 600000, // 10 minutes old
        direction: 'BUY',
        strength: 42,
        confidence: 45,
        finalScore: 25,
        entry: {
          price: 150.0,
          stopLoss: 149.5,
          takeProfit: 150.5
        },
        riskManagement: {},
        isValid: { isValid: true, checks: {}, reason: 'Valid' }
      },
      validation: { score: 55 }
    }
  ];

  signals.forEach((example, index) => {
    console.log(`Example ${index + 1}: ${example.name}`);
    console.log('-'.repeat(60));

    const signalRating = calculateSignalRating(example.signal, example.validation);
    console.log(`Pair: ${example.signal.pair} | Direction: ${example.signal.direction}`);
    console.log(
      `Strength: ${example.signal.strength}% | Confidence: ${example.signal.confidence}%`
    );
    console.log('\n' + getDetailedRatingReport(signalRating));
    console.log('\n');
  });

  console.log('='.repeat(60) + '\n');
}

/**
 * Display rating thresholds and interpretation guide
 */
function displayRatingGuide() {
  console.log('='.repeat(60));
  console.log('RATING INTERPRETATION GUIDE');
  console.log('='.repeat(60) + '\n');

  console.log('Rating Scale:');
  console.log('  90-100: A+ to A  (Excellent) - Highly recommended');
  console.log('  80-89:  A- to B+ (Very Good) - Recommended');
  console.log('  70-79:  B to B-  (Good)      - Consider with caution');
  console.log('  60-69:  C+ to C  (Fair)      - Marginal quality');
  console.log('  50-59:  C- to D+ (Average)   - Not recommended');
  console.log('  40-49:  D        (Below Avg) - Avoid');
  console.log('  0-39:   F        (Poor)      - Do not use');

  console.log('\nApplication Rating Components:');
  console.log('  - System Health (25%): Services status, providers availability, error rate');
  console.log('  - Performance (25%): Win rate, profit factor, Sharpe ratio, drawdown');
  console.log('  - Trading Quality (30%): Signal quality, risk management, trade volume');
  console.log('  - Data Quality (15%): Completeness, accuracy, timeliness, consistency');
  console.log('  - Uptime (5%): System availability');

  console.log('\nSignal Rating Components:');
  console.log('  - Strength (20%): Technical indicator strength');
  console.log('  - Confidence (25%): Analysis confidence level');
  console.log('  - Final Score (15%): Composite analysis score');
  console.log('  - Validation Score (20%): Multi-stage validation result');
  console.log('  - Risk-Reward (10%): Entry/exit ratio quality');
  console.log('  - Freshness (5%): Signal age');
  console.log('  - Completeness (5%): Data completeness');

  console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * Main function
 */
function main() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║    INTELLIGENT AUTO-TRADING SYSTEM - RATINGS REPORT      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    // Display all ratings
    const appRating = displayAppRating();
    displaySignalRatings();
    displayRatingGuide();

    // Summary
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(
      `\nApplication Overall Rating: ${appRating.overallRating.toFixed(1)}/100 (${appRating.grade})`
    );
    console.log(`Status: ${appRating.status}`);
    console.log('\nThe rating system provides objective metrics for:');
    console.log('  ✓ System health and reliability');
    console.log('  ✓ Trading performance and quality');
    console.log('  ✓ Signal strength and confidence');
    console.log('  ✓ Risk management effectiveness');
    console.log('  ✓ Data quality and freshness');
    console.log('\nUse these ratings to make informed trading decisions.');
    console.log('\n' + '='.repeat(60) + '\n');
  } catch (error) {
    console.error('Error displaying ratings:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { displayAppRating, displaySignalRatings, displayRatingGuide };
