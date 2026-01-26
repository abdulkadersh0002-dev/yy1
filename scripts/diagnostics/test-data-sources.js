#!/usr/bin/env node

/**
 * Test script to verify RSS feeds connectivity (EA-only + RSS-only mode)
 * Run with: node scripts/test-data-sources.js
 */

import RssFeedAggregator from '../../src/infrastructure/services/rss-feed-aggregator.js';

async function testRssFeeds() {
  console.log('\nTesting RSS Feeds...\n');
  console.log('='.repeat(60));

  const aggregator = new RssFeedAggregator();

  try {
    const news = await aggregator.fetchAll({ maxItems: 5 });

    if (news.length === 0) {
      console.log('No news items fetched');
      return false;
    }

    console.log(`Successfully fetched ${news.length} news items\n`);

    const bySource = {};
    news.forEach((item) => {
      if (!bySource[item.source]) {
        bySource[item.source] = [];
      }
      bySource[item.source].push(item);
    });

    console.log('News Sources Working:');
    Object.entries(bySource).forEach(([source, items]) => {
      console.log(`  OK ${source}: ${items.length} items`);
    });

    console.log('\nLatest Headlines:');
    news.slice(0, 5).forEach((item, i) => {
      const date = new Date(item.timestamp).toLocaleString();
      console.log(`  ${i + 1}. [${item.source}] ${item.headline.slice(0, 60)}...`);
      console.log(`     ${date}`);
    });

    return true;
  } catch (error) {
    console.log(`RSS Feed Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DATA SOURCES CONNECTIVITY TEST');
  console.log('='.repeat(60));

  const rssResult = await testRssFeeds();

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`RSS Feeds:    ${rssResult ? 'WORKING' : 'FAILED'}`);
  console.log('='.repeat(60));

  process.exit(rssResult ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
