import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import PriceDataFetcher from '../src/data/price-data-fetcher.js';
import { pairCatalog } from '../src/config/pair-catalog.js';
import { requireRealTimeData } from '../src/config/runtime-flags.js';

dotenv.config();

process.env.ALLOW_SYNTHETIC_DATA = 'false';
process.env.REQUIRE_REALTIME_DATA = 'true';

const DEFAULT_OUTPUT = path.resolve('logs/provider-validation.json');

const argMap = parseArgs(process.argv.slice(2));
const bars = resolveBarCount(argMap.bars);
const providerFilter = parseProviderFilter(argMap.provider);
const allowPartialFailure = argMap.allowPartialFailure === 'true';
const pairFilters = parseListArg(argMap.pair ?? process.env.PROVIDER_VALIDATION_PAIRS);
const timeframeFilters = parseListArg(
  argMap.timeframe ?? process.env.PROVIDER_VALIDATION_TIMEFRAMES
);
const outputPath = resolveOutputPath(argMap.output);

const apiKeys = {
  twelveData: process.env.TWELVE_DATA_API_KEY,
  polygon: process.env.POLYGON_API_KEY,
  finnhub: process.env.FINNHUB_API_KEY,
  alphaVantage: process.env.ALPHA_VANTAGE_API_KEY
};

const disabledProviders = parseDisabledProviders(process.env.PRICE_PROVIDERS_DISABLED);
const fetcher = new PriceDataFetcher(apiKeys, {
  allowUnconfiguredProviders: false,
  disabledProviders
});
const targets = buildTargets({ pairs: pairFilters, timeframes: timeframeFilters });

if (targets.length === 0) {
  console.error('No pair/timeframe targets resolved. Check the pair catalog or CLI arguments.');
  process.exit(1);
}

console.log('🔍 Validating live providers');
console.log(`   Targets: ${targets.length} pair/timeframe combinations`);
console.log(`   Bars: ${bars}`);
console.log(
  `   Provider filter: ${providerFilter ? providerFilter.join(', ') : 'all configured providers'}`
);
console.log('');

const aggregatedResults = [];

for (const target of targets) {
  const results = await validateTarget(target, { bars, providerFilter });
  aggregatedResults.push(...results);
}

printSummary(aggregatedResults);

await persistSummary(outputPath, {
  generatedAt: new Date().toISOString(),
  requireRealTime: requireRealTimeData(),
  bars,
  providerFilter,
  targets: targets.length,
  results: aggregatedResults
});

const failedProviders = aggregatedResults.filter((result) => !result.success);
if (failedProviders.length > 0 && !allowPartialFailure) {
  process.exit(1);
}
process.exit(0);

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

function resolveBarCount(input) {
  const parsed = Number.parseInt(input, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 120;
}

function parseProviderFilter(value) {
  if (!value) {
    return null;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDisabledProviders(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveOutputPath(value) {
  if (value === 'false') {
    return null;
  }
  if (!value) {
    return DEFAULT_OUTPUT;
  }
  return path.resolve(value);
}

function buildTargets({ pairs, timeframes }) {
  const normalizedPairs = normalizePairList(pairs);
  const normalizedTimeframes = normalizeTimeframeList(timeframes);
  const pairSet = normalizedPairs ? new Set(normalizedPairs) : null;
  const timeframeSet = normalizedTimeframes ? new Set(normalizedTimeframes) : null;

  const entries = pairCatalog.filter((entry) => {
    if (entry.enabled === false) {
      return false;
    }
    if (pairSet && !pairSet.has(entry.pair.toUpperCase())) {
      return false;
    }
    return true;
  });

  if (pairSet && entries.length === 0) {
    console.warn(
      `⚠️ Pair filter (${[...pairSet].join(', ')}) did not match any enabled instruments.`
    );
  }

  const targets = [];

  for (const entry of entries) {
    const configuredTimeframes =
      Array.isArray(entry.timeframes) && entry.timeframes.length > 0
        ? entry.timeframes
        : ['M15', 'H1', 'H4', 'D1'];

    const timeframesToUse = timeframeSet
      ? configuredTimeframes.filter((tf) => timeframeSet.has(tf.toUpperCase()))
      : configuredTimeframes;

    if (!timeframesToUse || timeframesToUse.length === 0) {
      console.warn(`⚠️ No matching timeframes for ${entry.pair}.`);
      continue;
    }

    for (const tf of timeframesToUse) {
      targets.push({
        pair: entry.pair,
        timeframeId: tf.toLowerCase(),
        timeframeLabel: tf.toUpperCase()
      });
    }
  }

  if (pairSet) {
    for (const pair of pairSet) {
      if (!entries.some((entry) => entry.pair.toUpperCase() === pair)) {
        console.warn(`⚠️ Pair ${pair} not found in catalog or disabled.`);
      }
    }
  }

  return targets;
}

function parseListArg(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizePairList(values) {
  if (!values || values.length === 0) {
    return null;
  }
  return values.map((pair) => pair.toUpperCase());
}

function normalizeTimeframeList(values) {
  if (!values || values.length === 0) {
    return null;
  }
  return values.map((value) => value.toUpperCase());
}

async function validateTarget(target, options) {
  const { bars, providerFilter } = options;
  console.log(`➡️  Pair ${target.pair} | Timeframe ${target.timeframeLabel}`);

  const providers = fetcher
    .getProviderOrder(target.timeframeId)
    .filter((provider) => fetcher.providerConfigured(provider))
    .filter((provider) => !providerFilter || providerFilter.includes(provider));

  if (providers.length === 0) {
    console.error(`   ❌ No providers configured for ${target.pair} ${target.timeframeLabel}.`);
    return [
      {
        pair: target.pair,
        timeframe: target.timeframeLabel,
        provider: 'none',
        label: 'No configured providers',
        success: false,
        barsReturned: 0,
        latencyMs: 0,
        error: 'No providers configured'
      }
    ];
  }

  console.log(
    `   Providers: ${providers.map((provider) => fetcher.getProviderLabel(provider)).join(', ')}`
  );

  const results = [];

  for (const provider of providers) {
    const label = fetcher.getProviderLabel(provider);
    const start = Date.now();
    try {
      const data = await fetcher.fetchFromProvider(provider, target.pair, target.timeframeId, bars);
      const latencyMs = Date.now() - start;
      const providerMetrics = fetcher.metrics.providers[provider] || {};
      const success = Array.isArray(data) && data.length > 0;
      const detail = {
        pair: target.pair,
        timeframe: target.timeframeLabel,
        provider,
        label,
        success,
        barsReturned: success ? data.length : 0,
        latencyMs,
        avgLatencyMs: providerMetrics.avgLatencyMs ?? null,
        targetLatencyMs: fetcher.providerLatencyTargets[provider] ?? null,
        successCount: providerMetrics.success || 0,
        failureCount: providerMetrics.failed || 0
      };

      if (success) {
        console.log(
          `   ✅ ${label} returned ${detail.barsReturned} bars (latency ${latencyMs} ms, avg ${detail.avgLatencyMs ?? 'n/a'} ms)`
        );
      } else {
        console.warn(`   ⚠️ ${label} returned no data.`);
      }

      results.push(detail);
    } catch (error) {
      console.error(`   ❌ ${label} request failed: ${error.message}`);
      results.push({
        pair: target.pair,
        timeframe: target.timeframeLabel,
        provider,
        label,
        success: false,
        barsReturned: 0,
        latencyMs: Date.now() - start,
        error: error.message
      });
    }
  }

  console.log('');
  return results;
}

function printSummary(items) {
  console.log('=== Provider Validation Summary ===');
  if (!items || items.length === 0) {
    console.log('No provider results to report.');
    console.log('===================================');
    return;
  }

  const grouped = new Map();
  for (const item of items) {
    const key = `${item.pair}|${item.timeframe}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  }

  for (const [key, entries] of grouped.entries()) {
    const [pair, timeframe] = key.split('|');
    console.log(`${pair} ${timeframe}`);
    for (const entry of entries) {
      if (entry.success) {
        console.log(
          `• ${entry.label}: ✅ ${entry.barsReturned} bars | latency ${entry.latencyMs} ms (avg ${entry.avgLatencyMs ?? 'n/a'} ms, target ${entry.targetLatencyMs ?? 'n/a'} ms)`
        );
      } else {
        console.log(`• ${entry.label}: ❌ ${entry.error || 'No data returned'}`);
      }
    }
    console.log('');
  }
  console.log('===================================');
}

async function persistSummary(outputFile, payload) {
  if (!outputFile) {
    return;
  }

  try {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Provider validation summary saved to ${outputFile}`);
  } catch (error) {
    console.warn(`⚠️ Unable to persist provider validation summary: ${error.message}`);
  }
}
