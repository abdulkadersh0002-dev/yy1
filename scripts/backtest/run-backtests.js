#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

import VectorizedBacktester from '../../src/core/backtesting/vectorized-backtester.js';
import { TransactionCostModel } from '../../src/core/backtesting/transaction-cost-model.js';
import runMonteCarloSimulations from '../../src/core/backtesting/monte-carlo-simulator.js';
import runWalkForwardValidation from '../../src/core/backtesting/walk-forward-validator.js';

async function ensureReportDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
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

function resolveConfigPath(rawPath) {
  if (rawPath) {
    return path.resolve(rawPath);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '../../config/backtest.config.json');
}

async function loadConfig(configPath) {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Backtest config not found at ${configPath}`);
    }
    throw new Error(`Failed to load backtest config: ${error.message}`);
  }
}

async function loadJsonArray(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(data);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed?.data)) {
    return parsed.data;
  }
  return [];
}

async function loadCsvArray(filePath) {
  const rows = [];
  await new Promise((resolve, reject) => {
    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      })
    );

    parser.on('data', (row) => rows.push(row));
    parser.on('error', reject);
    parser.on('end', resolve);
  });
  return rows;
}

async function loadDatasetFile(descriptor) {
  const fullPath = path.resolve(descriptor.path);
  const format = (
    descriptor.format ||
    path.extname(fullPath).replace('.', '') ||
    'json'
  ).toLowerCase();

  try {
    if (format === 'csv') {
      return await loadCsvArray(fullPath);
    }
    if (format === 'json' || format === 'ndjson') {
      return await loadJsonArray(fullPath);
    }
    throw new Error(`Unsupported dataset format: ${format}`);
  } catch (error) {
    return {
      error: error.message,
      path: fullPath,
      format
    };
  }
}

async function loadDataset(descriptor = {}) {
  if (!descriptor.priceFile && !descriptor.signalFile) {
    return {
      error: 'Dataset descriptor requires priceFile and signalFile entries.'
    };
  }

  const [barsResult, signalsResult] = await Promise.all([
    loadDatasetFile(descriptor.priceFile),
    loadDatasetFile(descriptor.signalFile)
  ]);

  if (barsResult?.error || signalsResult?.error) {
    return {
      error: 'Failed to load dataset files',
      details: {
        bars: barsResult?.error || null,
        signals: signalsResult?.error || null
      }
    };
  }

  return {
    bars: barsResult,
    signals: signalsResult
  };
}

function instantiateBacktester(datasetConfig = {}, globalConfig = {}) {
  const transactionCostOptions = {
    ...(globalConfig.transactionCosts || {}),
    ...(datasetConfig.transactionCosts || {})
  };

  const transactionCostModel = new TransactionCostModel(transactionCostOptions);
  return new VectorizedBacktester({
    ...globalConfig.backtesterOptions,
    ...datasetConfig.backtesterOptions,
    transactionCostModel
  });
}

function summarize(result, { label }) {
  console.log('----------------------------------------');
  console.log(`Dataset: ${label}`);
  if (result?.error) {
    console.log(`  Error: ${result.error}`);
    if (result.details) {
      console.log('  Details:', result.details);
    }
    return;
  }
  const metrics = result.metrics || {};
  console.log(`  Trades       : ${metrics.totalTrades}`);
  console.log(`  Win rate     : ${(metrics.winRate * 100).toFixed(2)}%`);
  console.log(`  Net Pips     : ${metrics.netPips}`);
  console.log(`  Sharpe       : ${metrics.sharpe}`);
  console.log(`  Max DD       : ${metrics.maxDrawdownPct}%`);
  if (result.monteCarlo) {
    console.log(`  MC p05       : ${result.monteCarlo.percentile5ReturnPct}%`);
    console.log(`  MC p95       : ${result.monteCarlo.percentile95ReturnPct}%`);
  }
  if (result.walkForward) {
    console.log(`  WF windows   : ${result.walkForward.results.length}`);
    console.log(`  WF agg trades: ${result.walkForward.aggregateMetrics.totalTrades}`);
  }
}

async function writeReport(outputDir, label, payload) {
  await ensureReportDirectory(outputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${label.replace(/\s+/g, '-').toLowerCase()}-${timestamp}.json`;
  const fullPath = path.join(outputDir, fileName);
  await fs.writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8');
  return fullPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolveConfigPath(args.config);
  const config = await loadConfig(configPath);

  const datasets = Array.isArray(config.datasets) ? config.datasets : [];
  if (datasets.length === 0) {
    console.error('No datasets configured. Populate config.backtest.config.json before running.');
    process.exit(1);
  }

  const outputDir = config.outputDir
    ? path.resolve(config.outputDir)
    : path.resolve('reports/backtesting');

  await ensureReportDirectory(outputDir);

  const reports = [];

  for (const datasetConfig of datasets) {
    const label =
      datasetConfig.label || `${datasetConfig.pair || 'pair'}-${datasetConfig.timeframe || 'tf'}`;
    const loaded = await loadDataset(datasetConfig);
    if (loaded.error) {
      const result = { label, error: loaded.error, details: loaded.details };
      summarize(result, { label });
      reports.push(result);
      continue;
    }

    const backtester = instantiateBacktester(datasetConfig, config);
    const runResult = backtester.run({
      pair: datasetConfig.pair,
      timeframe: datasetConfig.timeframe,
      bars: loaded.bars,
      signals: loaded.signals
    });

    let monteCarlo = null;
    if (config.monteCarlo?.enabled !== false) {
      monteCarlo = runMonteCarloSimulations(runResult.trades, config.monteCarlo || {});
    }

    let walkForward = null;
    if (config.walkForward?.enabled) {
      walkForward = runWalkForwardValidation({
        pair: datasetConfig.pair,
        timeframe: datasetConfig.timeframe,
        bars: loaded.bars,
        signals: loaded.signals,
        backtester,
        options: config.walkForward
      });
    }

    const datasetReport = {
      label,
      pair: datasetConfig.pair,
      timeframe: datasetConfig.timeframe,
      run: runResult,
      metrics: runResult.metrics,
      monteCarlo,
      walkForward
    };

    summarize(datasetReport, { label });

    const reportPath = await writeReport(outputDir, label, datasetReport);
    reports.push({
      label,
      reportPath,
      metrics: datasetReport.metrics,
      monteCarlo,
      walkForward: walkForward ? { windowCount: walkForward.results.length } : null
    });
  }

  console.log('========================================');
  console.log('Backtesting completed.');
  console.log('Reports saved to:', outputDir);
}

main().catch((error) => {
  console.error('Backtesting script failed:', error.message);
  process.exit(1);
});
