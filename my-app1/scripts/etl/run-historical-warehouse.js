#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HistoricalWarehouseRunner from '../../src/etl/historical-warehouse-runner.js';

function parseArgs(argv) {
  const map = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      map[key] = next;
      i += 1;
    } else {
      map[key] = 'true';
    }
  }
  return map;
}

async function loadConfig(configPath) {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Historical warehouse config not found at ${configPath}`);
    }
    throw new Error(`Failed to parse historical warehouse config: ${error.message}`);
  }
}

function resolveConfigPath(rawPath) {
  if (rawPath) {
    return path.resolve(rawPath);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '../../config/historical-warehouse.config.json');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRunFlag =
    args['dry-run'] === 'true' || args.dryRun === 'true' || args['dryRun'] === 'true';
  const configPath = resolveConfigPath(args.config);

  const config = await loadConfig(configPath);
  if (dryRunFlag && typeof config.dryRun === 'undefined') {
    config.dryRun = true;
  }

  const runner = new HistoricalWarehouseRunner(config);
  const summary = await runner.run({ dryRun: dryRunFlag });

  printSummary(summary);
}

function printSummary(summary) {
  const divider = ''.padEnd(60, '=');
  console.log(divider);
  console.log(' Historical Warehouse ETL Summary');
  console.log(divider);
  console.log(` Dry run          : ${summary.dryRun ? 'yes' : 'no'}`);
  console.log(` Price sources    : ${summary.priceSources}`);
  summary.priceResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${result.error ? `, error: ${result.error}` : ''}`
    );
  });
  console.log(` Macro sources    : ${summary.macroSources}`);
  summary.macroResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${result.error ? `, error: ${result.error}` : ''}`
    );
  });
  console.log(` News sources     : ${summary.newsSources}`);
  summary.newsResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${result.error ? `, error: ${result.error}` : ''}`
    );
  });

  if (summary.featureNormalization) {
    const normalization = summary.featureNormalization;
    console.log(' Feature normalization');
    console.log(`   • processed snapshots : ${normalization.processedSnapshots}`);
    console.log(`   • flattened features  : ${normalization.flattenedFeatures}`);
    console.log(`   • persisted rows      : ${normalization.persisted}`);
    console.log(`   • skipped snapshots   : ${normalization.skippedSnapshots}`);
    if (normalization.note) {
      console.log(`   • note                : ${normalization.note}`);
    }
  }

  console.log(divider);
}

main().catch((error) => {
  console.error('Historical warehouse ETL failed:', error.message);
  process.exit(1);
});
