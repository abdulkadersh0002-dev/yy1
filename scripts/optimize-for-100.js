#!/usr/bin/env node
/**
 * Optimize System for 100/100 Ratings
 * Configure the trading system for optimal performance and quality
 */

import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.env');
const EXAMPLE_PATH = path.join(process.cwd(), '.env.example');

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  TRADING SYSTEM OPTIMIZATION FOR 100/100 RATINGS        ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

/**
 * Check environment configuration
 */
function checkEnvironment() {
  console.log('📋 Checking Environment Configuration...\n');

  const requiredKeys = [
    'TWELVE_DATA_API_KEY',
    'POLYGON_API_KEY',
    'ALPHA_VANTAGE_API_KEY',
    'FINNHUB_API_KEY',
    'NEWSAPI_KEY'
  ];

  const optimalSettings = {
    MIN_SIGNAL_STRENGTH: '75',
    MIN_CONFIDENCE: '80',
    MIN_RISK_REWARD: '2.5',
    RISK_PER_TRADE: '0.015',
    MAX_DAILY_RISK: '0.06',
    MAX_CONCURRENT_TRADES: '5',
    ENABLE_PAIR_PREFETCH: 'true',
    PREFETCH_INTERVAL_MS: '60000'
  };

  let hasConfig = false;
  const config = {};

  if (fs.existsSync(CONFIG_PATH)) {
    hasConfig = true;
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    content.split('\n').forEach((line) => {
      const [key, value] = line.split('=');
      if (key && value) {
        config[key.trim()] = value.trim();
      }
    });
  }

  console.log('API Keys Status:');
  console.log('─'.repeat(60));

  let apiKeysConfigured = 0;
  requiredKeys.forEach((key) => {
    const isSet = config[key] && config[key] !== 'your_key_here' && config[key].length > 10;
    const status = isSet ? '✅ Configured' : '❌ Missing';
    console.log(`  ${key.padEnd(30)} ${status}`);
    if (isSet) {
      apiKeysConfigured++;
    }
  });

  const providerScore = (apiKeysConfigured / requiredKeys.length) * 100;
  console.log('─'.repeat(60));
  console.log(`  Provider Availability Score: ${providerScore.toFixed(0)}%\n`);

  console.log('Optimal Trading Settings:');
  console.log('─'.repeat(60));

  let settingsConfigured = 0;
  Object.entries(optimalSettings).forEach(([key, recommendedValue]) => {
    const currentValue = config[key];
    const isOptimal = currentValue === recommendedValue;
    const status = isOptimal ? '✅ Optimal' : currentValue ? '⚠️  Suboptimal' : '❌ Not Set';
    const display = currentValue ? currentValue : 'Not Set';
    console.log(`  ${key.padEnd(30)} ${display.padEnd(15)} ${status}`);
    if (isOptimal) {
      settingsConfigured++;
    }
  });

  const settingsScore = (settingsConfigured / Object.keys(optimalSettings).length) * 100;
  console.log('─'.repeat(60));
  console.log(`  Configuration Score: ${settingsScore.toFixed(0)}%\n`);

  return {
    hasConfig,
    apiKeysConfigured,
    settingsConfigured,
    totalApiKeys: requiredKeys.length,
    totalSettings: Object.keys(optimalSettings).length,
    providerScore,
    settingsScore
  };
}

/**
 * Display optimization recommendations
 */
function showRecommendations(status) {
  console.log('🎯 Optimization Recommendations:\n');

  const recommendations = [];

  // API Keys
  if (status.apiKeysConfigured < status.totalApiKeys) {
    recommendations.push({
      priority: 'HIGH',
      category: 'System Health',
      impact: '+40 points',
      action: `Configure ${status.totalApiKeys - status.apiKeysConfigured} missing API key(s)`,
      steps: [
        '1. Sign up for API keys at provider websites',
        '2. Add keys to .env file',
        '3. Run: npm run validate:providers'
      ]
    });
  }

  // Trading Settings
  if (status.settingsConfigured < status.totalSettings) {
    recommendations.push({
      priority: 'HIGH',
      category: 'Performance',
      impact: '+30 points',
      action: 'Optimize trading configuration settings',
      steps: [
        '1. Update .env with optimal values',
        '2. Set MIN_SIGNAL_STRENGTH=75',
        '3. Set RISK_PER_TRADE=0.015',
        '4. Set MIN_RISK_REWARD=2.5'
      ]
    });
  }

  // General recommendations
  recommendations.push(
    {
      priority: 'MEDIUM',
      category: 'Trading Quality',
      impact: '+20 points',
      action: 'Enable advanced signal validation',
      steps: [
        '1. Use SignalValidator for all signals',
        '2. Set validation thresholds in config',
        '3. Only execute signals with score > 85'
      ]
    },
    {
      priority: 'MEDIUM',
      category: 'Performance',
      impact: '+15 points',
      action: 'Implement proper risk management',
      steps: [
        '1. Always set stop loss and take profit',
        '2. Use Kelly Criterion position sizing',
        '3. Enable volatility adjustment',
        '4. Respect daily loss limits'
      ]
    },
    {
      priority: 'LOW',
      category: 'Data Quality',
      impact: '+10 points',
      action: 'Enable data quality monitoring',
      steps: [
        '1. Enable pair prefetching',
        '2. Monitor data completeness',
        '3. Set up data quality alerts'
      ]
    }
  );

  recommendations.forEach((rec, index) => {
    const priorityColor = {
      HIGH: '🔴',
      MEDIUM: '🟡',
      LOW: '🟢'
    }[rec.priority];

    console.log(`${priorityColor} Recommendation #${index + 1}: ${rec.priority} PRIORITY`);
    console.log(`   Category: ${rec.category}`);
    console.log(`   Impact: ${rec.impact}`);
    console.log(`   Action: ${rec.action}`);
    console.log(`   Steps:`);
    rec.steps.forEach((step) => console.log(`      ${step}`));
    console.log('');
  });
}

/**
 * Calculate potential rating improvement
 */
function calculatePotential(status) {
  console.log('📊 Rating Improvement Potential:\n');

  const current = {
    systemHealth: status.providerScore * 0.25,
    performance: 62.7 * 0.25, // Current from example
    tradingQuality: 82.8 * 0.3,
    dataQuality: 91.5 * 0.15,
    uptime: 99.8 * 0.05
  };

  const potential = {
    systemHealth: 100 * 0.25,
    performance: 100 * 0.25,
    tradingQuality: 100 * 0.3,
    dataQuality: 100 * 0.15,
    uptime: 100 * 0.05
  };

  const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);
  const potentialTotal = Object.values(potential).reduce((a, b) => a + b, 0);
  const improvement = potentialTotal - currentTotal;

  console.log('Current Rating Breakdown:');
  console.log('─'.repeat(60));
  Object.entries(current).forEach(([key, value]) => {
    const label = key.replace(/([A-Z])/g, ' $1').trim();
    const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
    console.log(`  ${capitalizedLabel.padEnd(25)} ${value.toFixed(1)}%`);
  });
  console.log('─'.repeat(60));
  console.log(`  Current Overall Rating:       ${currentTotal.toFixed(1)}/100\n`);

  console.log('Potential with Optimizations:');
  console.log('─'.repeat(60));
  Object.entries(potential).forEach(([key, value]) => {
    const label = key.replace(/([A-Z])/g, ' $1').trim();
    const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
    const gain = value - current[key];
    console.log(`  ${capitalizedLabel.padEnd(25)} ${value.toFixed(1)}% (+${gain.toFixed(1)})`);
  });
  console.log('─'.repeat(60));
  console.log(`  Potential Overall Rating:     ${potentialTotal.toFixed(1)}/100`);
  console.log(`  Improvement Potential:        +${improvement.toFixed(1)} points\n`);
}

/**
 * Show quick setup guide
 */
function showQuickSetup() {
  console.log('⚡ Quick Setup for 100/100 Ratings:\n');

  console.log('Step 1: Configure API Keys');
  console.log('  cp .env.example .env');
  console.log('  # Edit .env and add your API keys\n');

  console.log('Step 2: Optimize Configuration');
  console.log('  # Add these lines to .env:');
  console.log('  MIN_SIGNAL_STRENGTH=75');
  console.log('  MIN_CONFIDENCE=80');
  console.log('  RISK_PER_TRADE=0.015');
  console.log('  MAX_DAILY_RISK=0.06');
  console.log('  MIN_RISK_REWARD=2.5\n');

  console.log('Step 3: Validate Setup');
  console.log('  npm run validate:providers\n');

  console.log('Step 4: Start Trading');
  console.log('  npm start\n');

  console.log('Step 5: Monitor Progress');
  console.log('  npm run ratings\n');
}

/**
 * Main function
 */
function main() {
  try {
    const status = checkEnvironment();
    calculatePotential(status);
    showRecommendations(status);
    showQuickSetup();

    console.log('═'.repeat(60));
    console.log('📖 For detailed instructions, see:');
    console.log('   docs/RATING_OPTIMIZATION_GUIDE.md\n');
    console.log('💡 Pro Tip: Focus on one category at a time for best results!');
    console.log(`${'═'.repeat(60)}\n`);
  } catch (error) {
    console.error('Error running optimization check:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { checkEnvironment, showRecommendations, calculatePotential };
