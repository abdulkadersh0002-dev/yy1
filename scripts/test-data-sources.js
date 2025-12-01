#!/usr/bin/env node

/**
 * Test script to verify RSS feeds and TwelveData API connectivity
 * Run with: node scripts/test-data-sources.js
 */

import RssFeedAggregator from '../src/services/rss-feed-aggregator.js';

const TWELVEDATA_API_KEY = process.env.TWELVE_DATA_API_KEY || '71ff8cb4d4c94e3780b0245ee564bbda';

async function testRssFeeds() {
  console.log('\n📰 Testing RSS Feeds...\n');
  console.log('='.repeat(60));

  const aggregator = new RssFeedAggregator();

  try {
    const news = await aggregator.fetchAll({ maxItems: 5 });

    if (news.length === 0) {
      console.log('❌ No news items fetched');
      return false;
    }

    console.log(`✅ Successfully fetched ${news.length} news items\n`);

    // Group by source
    const bySource = {};
    news.forEach((item) => {
      if (!bySource[item.source]) {
        bySource[item.source] = [];
      }
      bySource[item.source].push(item);
    });

    // Show summary
    console.log('News Sources Working:');
    Object.entries(bySource).forEach(([source, items]) => {
      console.log(`  ✅ ${source}: ${items.length} items`);
    });

    console.log('\nLatest Headlines:');
    news.slice(0, 5).forEach((item, i) => {
      const date = new Date(item.timestamp).toLocaleString();
      console.log(`  ${i + 1}. [${item.source}] ${item.headline.slice(0, 60)}...`);
      console.log(`     📅 ${date}`);
    });

    return true;
  } catch (error) {
    console.log(`❌ RSS Feed Error: ${error.message}`);
    return false;
  }
}

async function testTwelveData() {
  console.log('\n📊 Testing TwelveData API...\n');
  console.log('='.repeat(60));
  console.log(`API Key: ${TWELVEDATA_API_KEY.slice(0, 8)}...${TWELVEDATA_API_KEY.slice(-4)}`);

  const axios = (await import('axios')).default;

  try {
    // Test 1: Get quote for EUR/USD
    console.log('\n1. Testing EUR/USD Quote...');
    const quoteResponse = await axios.get('https://api.twelvedata.com/quote', {
      params: {
        symbol: 'EUR/USD',
        apikey: TWELVEDATA_API_KEY
      },
      timeout: 10000
    });

    if (quoteResponse.data.code === 429) {
      console.log('⚠️ Rate limit hit - API is working but needs cooldown');
    } else if (quoteResponse.data.close) {
      console.log(`✅ EUR/USD Quote: ${quoteResponse.data.close}`);
      console.log(`   Open: ${quoteResponse.data.open}`);
      console.log(`   High: ${quoteResponse.data.high}`);
      console.log(`   Low: ${quoteResponse.data.low}`);
      console.log(`   Volume: ${quoteResponse.data.volume || 'N/A'}`);
    } else {
      console.log(`❌ Invalid response: ${JSON.stringify(quoteResponse.data).slice(0, 100)}`);
    }

    // Test 2: Get time series data
    console.log('\n2. Testing EUR/USD Time Series (M15)...');
    const timeSeriesResponse = await axios.get('https://api.twelvedata.com/time_series', {
      params: {
        symbol: 'EUR/USD',
        interval: '15min',
        outputsize: 10,
        apikey: TWELVEDATA_API_KEY
      },
      timeout: 10000
    });

    if (timeSeriesResponse.data.code === 429) {
      console.log('⚠️ Rate limit hit - API is working but needs cooldown');
    } else if (timeSeriesResponse.data.values) {
      const bars = timeSeriesResponse.data.values;
      console.log(`✅ Received ${bars.length} price bars`);
      console.log(
        `   Latest: ${bars[0].datetime} - O:${bars[0].open} H:${bars[0].high} L:${bars[0].low} C:${bars[0].close}`
      );
    } else {
      console.log(`❌ Invalid response: ${JSON.stringify(timeSeriesResponse.data).slice(0, 100)}`);
    }

    // Test 3: Get multiple pairs
    console.log('\n3. Testing Multiple Currency Pairs...');
    const pairs = ['GBP/USD', 'USD/JPY', 'AUD/USD'];

    for (const pair of pairs) {
      try {
        const response = await axios.get('https://api.twelvedata.com/price', {
          params: {
            symbol: pair,
            apikey: TWELVEDATA_API_KEY
          },
          timeout: 5000
        });

        if (response.data.price) {
          console.log(`   ✅ ${pair}: ${response.data.price}`);
        } else if (response.data.code === 429) {
          console.log(`   ⚠️ ${pair}: Rate limit - try again later`);
        } else {
          console.log(`   ❌ ${pair}: ${response.data.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.log(`   ❌ ${pair}: ${error.message}`);
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    return true;
  } catch (error) {
    console.log(`❌ TwelveData Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 DATA SOURCES CONNECTIVITY TEST');
  console.log('='.repeat(60));

  const rssResult = await testRssFeeds();
  const twelveDataResult = await testTwelveData();

  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log(`RSS Feeds:    ${rssResult ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`TwelveData:   ${twelveDataResult ? '✅ WORKING' : '❌ FAILED'}`);
  console.log('='.repeat(60));

  if (rssResult && twelveDataResult) {
    console.log('\n🎉 All data sources are working correctly!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️ Some data sources have issues. Check the logs above.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
