import dotenv from 'dotenv';
import RssFeedAggregator from '../../src/infrastructure/services/rss-feed-aggregator.js';

dotenv.config();

// NOTE: This project now defaults to EA-only + RSS-only mode.
// Live price/news providers that require API keys are intentionally disabled.
// This script remains as a lightweight connectivity check for RSS feeds.

const argMap = parseArgs(process.argv.slice(2));
const maxItems = resolveMaxItems(argMap.maxItems);

console.log('Validating RSS feeds (EA-only + RSS-only mode)');
console.log(`maxItems: ${maxItems}`);
console.log('');

try {
  const aggregator = new RssFeedAggregator();
  const items = await aggregator.fetchAll({ maxItems });

  if (!Array.isArray(items) || items.length === 0) {
    console.error('RSS validation failed: no items fetched');
    process.exit(1);
  }

  console.log(`RSS validation ok: ${items.length} items fetched`);
  process.exit(0);
} catch (error) {
  console.error('RSS validation failed:', error?.message || error);
  process.exit(1);
}

function parseArgs(args) {
  const map = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        map[key] = next;
        i++;
      } else {
        map[key] = 'true';
      }
    }
  }
  return map;
}

function resolveMaxItems(input) {
  const parsed = Number.parseInt(input, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(200, parsed);
  }
  return 25;
}
