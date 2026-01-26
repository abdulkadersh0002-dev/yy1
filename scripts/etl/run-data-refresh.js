#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HistoricalWarehouseRunner from '../../src/infrastructure/etl/historical-warehouse-runner.js';

const DEFAULT_FRESHNESS_MINUTES = 10;

async function loadJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const data = await fs.readFile(resolved, 'utf8');
  return JSON.parse(data);
}

function resolveRelative(basePath, targetPath) {
  if (!targetPath) {
    return null;
  }
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  const baseDir = path.dirname(basePath);
  return path.resolve(baseDir, targetPath);
}

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

async function runEtl(etlConfigPath, dryRunFlag) {
  const etlConfig = await loadJsonFile(etlConfigPath);
  const runner = new HistoricalWarehouseRunner(etlConfig);
  const summary = await runner.run({ dryRun: dryRunFlag });
  return summary;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Request to ${url} failed (${response.status} ${response.statusText}): ${text}`
    );
  }
  return response.json();
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function getSnapshotFreshness(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null;
  }
  let latest = null;
  for (const snapshot of snapshots) {
    const ts = toTimestamp(snapshot?.ts || snapshot?.timestamp || snapshot?.updatedAt);
    if (ts && (!latest || ts > latest)) {
      latest = ts;
    }
  }
  return latest;
}

function formatMinutesAgo(timestamp) {
  if (!timestamp) {
    return 'unknown';
  }
  const diffMinutes = (Date.now() - timestamp) / 60000;
  return `${diffMinutes.toFixed(1)}m ago`;
}

async function validateFeeds(baseUrl, freshnessMinutes) {
  const results = [];
  const thresholdMs = (freshnessMinutes ?? DEFAULT_FRESHNESS_MINUTES) * 60 * 1000;

  const statusUrl = new URL('/api/status', baseUrl).toString();
  const statusPayload = await fetchJson(statusUrl);
  const statusTimestamp = toTimestamp(statusPayload?.status?.updatedAt || statusPayload?.timestamp);
  const statusAgeOk = statusTimestamp ? Date.now() - statusTimestamp <= thresholdMs : false;
  const statusEnabled = Boolean(statusPayload?.status?.enabled);
  results.push({
    name: 'engine-status',
    ok: statusAgeOk && statusEnabled,
    enabled: statusEnabled,
    timestamp: statusTimestamp,
    freshness: statusTimestamp ? Date.now() - statusTimestamp : null,
    detail: statusTimestamp
      ? `status ${statusEnabled ? 'enabled' : 'disabled'} · updated ${formatMinutesAgo(statusTimestamp)}`
      : 'status timestamp unavailable'
  });

  const featureUrl = new URL('/api/features-snapshots?limit=24', baseUrl).toString();
  const featurePayload = await fetchJson(featureUrl);
  const snapshots = Array.isArray(featurePayload?.snapshots) ? featurePayload.snapshots : [];
  const latestSnapshotTs = getSnapshotFreshness(snapshots);
  const featuresFresh = latestSnapshotTs ? Date.now() - latestSnapshotTs <= thresholdMs : false;
  results.push({
    name: 'feature-snapshots',
    ok: featuresFresh && snapshots.length > 0,
    count: snapshots.length,
    timestamp: latestSnapshotTs,
    freshness: latestSnapshotTs ? Date.now() - latestSnapshotTs : null,
    detail:
      snapshots.length === 0
        ? 'no feature snapshots returned'
        : `latest snapshot ${formatMinutesAgo(latestSnapshotTs)} · total ${snapshots.length}`
  });

  return results;
}

function printEtlSummary(summary) {
  const divider = ''.padEnd(70, '=');
  console.log(divider);
  console.log(' ETL Refresh Summary');
  console.log(divider);
  console.log(` Dry run           : ${summary.dryRun ? 'yes' : 'no'}`);
  console.log(` Price sources     : ${summary.priceSources}`);
  summary.priceResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${
        result.error ? `, error: ${result.error}` : ''
      }`
    );
  });
  console.log(` Macro sources     : ${summary.macroSources}`);
  summary.macroResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${
        result.error ? `, error: ${result.error}` : ''
      }`
    );
  });
  console.log(` News sources      : ${summary.newsSources}`);
  summary.newsResults.forEach((result) => {
    console.log(
      `   • ${result.label}: processed ${result.processed}, persisted ${result.persisted}, skipped ${result.skipped}${
        result.error ? `, error: ${result.error}` : ''
      }`
    );
  });
  if (summary.featureNormalization) {
    const normalization = summary.featureNormalization;
    console.log(' Feature normalization:');
    console.log(`   • processed snapshots : ${normalization.processedSnapshots}`);
    console.log(`   • flattened features  : ${normalization.flattenedFeatures}`);
    console.log(`   • persisted rows      : ${normalization.persisted}`);
    if (normalization.note) {
      console.log(`   • note                : ${normalization.note}`);
    }
  }
}

function printHealthSummary(results, thresholdMinutes) {
  const divider = ''.padEnd(70, '-');
  console.log(divider);
  console.log(` Feed Freshness (threshold ${thresholdMinutes}m)`);
  console.log(divider);
  results.forEach((result) => {
    const status = result.ok ? 'OK' : 'ATTENTION';
    console.log(` ${result.name.padEnd(20)} : ${status} — ${result.detail}`);
  });
  console.log(divider);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultConfigPath = path.resolve(moduleDir, '../../config/data-refresh.config.json');
  const configPath = args.config ? path.resolve(args.config) : defaultConfigPath;
  const config = await loadJsonFile(configPath);

  const freshnessMinutes = Number.isFinite(Number(config.freshnessThresholdMinutes))
    ? Number(config.freshnessThresholdMinutes)
    : DEFAULT_FRESHNESS_MINUTES;

  const dryRunFlag =
    args['dry-run'] === 'true' || args.dryRun === 'true' || args['dryRun'] === 'true';
  const etlConfigPath = resolveRelative(
    configPath,
    config.etlConfigPath || './historical-warehouse.config.json'
  );
  const apiBaseUrl = config.apiBaseUrl || 'http://localhost:4101';

  if (!etlConfigPath) {
    throw new Error(
      'ETL config path not provided. Set "etlConfigPath" in data-refresh.config.json or pass --config.'
    );
  }

  console.log('Starting ETL refresh...');
  const etlSummary = await runEtl(etlConfigPath, dryRunFlag);
  printEtlSummary(etlSummary);

  console.log('\nRunning feed health validation...');
  const healthResults = await validateFeeds(apiBaseUrl, freshnessMinutes);
  printHealthSummary(healthResults, freshnessMinutes);

  const allOk = healthResults.every((item) => item.ok);
  if (!allOk) {
    console.warn('One or more feed checks failed. Investigate the ETL pipeline or data sources.');
    process.exitCode = 1;
  } else {
    console.log('All feeds are fresh and the engine is reporting healthy telemetry.');
  }
}

main().catch((error) => {
  console.error('Data refresh workflow failed:', error.message);
  process.exit(1);
});
