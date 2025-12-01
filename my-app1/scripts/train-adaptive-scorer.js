#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import AdaptiveScorer from '../src/services/adaptive-scorer.js';

const historicalPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('data/historical-signals.json');

function loadHistoricalDataset(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(
      `No historical dataset found at ${filePath}. Provide a JSON file or export from the feature store.`
    );
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error('Historical dataset must be a non-empty array');
    }
    return json;
  } catch (err) {
    console.error(`Failed to load historical dataset: ${err.message}`);
    process.exit(1);
  }
}

function summarizeThresholds(updated) {
  return Object.entries(updated).map(([pair, info]) => ({
    pair,
    buy: info.buy,
    sell: info.sell,
    score: info.score,
    precision: info.metrics?.precision ?? null,
    recall: info.metrics?.recall ?? null,
    f1: info.metrics?.f1 ?? null
  }));
}

async function main() {
  const historical = loadHistoricalDataset(historicalPath);
  const scorer = new AdaptiveScorer();

  const prepared = scorer.prepareTrainingDataset(historical);
  if (!prepared.length) {
    console.error(
      'Prepared dataset is empty after feature extraction. Check historical data format.'
    );
    process.exit(1);
  }

  const training = prepared.map(({ features, label }) => ({ features, label }));
  scorer.trainModel(training);

  const shapSummary = scorer.generateShapSummary(prepared);

  const evaluated = scorer.evaluateDataset(prepared);
  const datasetByPair = evaluated.reduce((acc, entry) => {
    acc[entry.pair] = acc[entry.pair] || [];
    acc[entry.pair].push({ probability: entry.probability, label: entry.label });
    return acc;
  }, {});

  const sampleCounts = Object.fromEntries(
    Object.entries(datasetByPair).map(([pair, entries]) => [pair, entries.length])
  );
  const minAvailableSamples = Object.values(sampleCounts).length
    ? Math.min(...Object.values(sampleCounts))
    : 0;

  if (minAvailableSamples && minAvailableSamples < scorer.thresholdManager.minSamples) {
    const previousMin = scorer.thresholdManager.minSamples;
    scorer.thresholdManager.minSamples = Math.max(2, minAvailableSamples);
    console.log(
      `Adjusted threshold optimizer minSamples from ${previousMin} to ${scorer.thresholdManager.minSamples}` +
        ' based on available historical coverage.'
    );
  }

  const thresholds = scorer.optimizeThresholds(datasetByPair);

  console.log('Adaptive scorer model and thresholds updated successfully.');
  console.table(summarizeThresholds(thresholds));
  if (shapSummary?.features?.length) {
    console.log('\nTop feature contributions (mean absolute impact):');
    console.table(
      shapSummary.features.slice(0, 10).map((entry) => ({
        feature: entry.feature,
        meanContribution: Number(entry.meanContribution.toFixed(4)),
        meanAbsContribution: Number(entry.meanAbsContribution.toFixed(4)),
        importance: Number(entry.importance.toFixed(4))
      }))
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
