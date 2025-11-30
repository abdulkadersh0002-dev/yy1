import dotenv from 'dotenv';
import RssFeedAggregator from '../src/services/rss-feed-aggregator.js';

dotenv.config();

async function main() {
  const aggregator = new RssFeedAggregator({
    apiKeys: {
      polygon: process.env.POLYGON_API_KEY,
      finnhub: process.env.FINNHUB_API_KEY
    }
  });
  const keywords = process.argv
    .slice(2)
    .map((arg) => arg.trim())
    .filter(Boolean);
  const results = await aggregator.fetchAll({
    maxItems: 15,
    keywords
  });

  console.log(
    `Fetched ${results.length} normalized headlines${keywords.length ? ` for keywords: ${keywords.join(', ')}` : ''}.`
  );
  for (const item of results.slice(0, 20)) {
    console.log('-'.repeat(80));
    console.log(`Source   : ${item.source}`);
    console.log(`Headline : ${item.headline}`);
    console.log(`Time     : ${new Date(item.timestamp).toISOString()}`);
    if (item.summary) {
      console.log(
        `Summary  : ${item.summary.slice(0, 160)}${item.summary.length > 160 ? '…' : ''}`
      );
    }
    console.log(`URL      : ${item.url}`);
  }
}

main().catch((error) => {
  console.error('RSS aggregation failed:', error);
  process.exitCode = 1;
});
