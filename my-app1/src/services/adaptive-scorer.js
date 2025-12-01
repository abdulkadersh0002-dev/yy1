import fs from 'fs';
import path from 'path';
import AdvancedEnsembleModel from './ml/tree-ensemble.js';
import GradientBoostingClassifier from './ml/gradient-boosting.js';
import AdaptiveThresholdManager from './ml/adaptive-threshold-manager.js';

class AdaptiveScorer {
  constructor(options = {}) {
    this.config = {
      modelPath: options.modelPath || path.resolve('data/models/adaptive-ensemble-model.json'),
      thresholdsPath: options.thresholdsPath || path.resolve('data/models/pair-thresholds.json'),
      shapSummaryPath:
        options.shapSummaryPath || path.resolve('data/models/ensemble-shap-summary.json'),
      ruleWeights: options.ruleWeights || { economic: 0.2, news: 0.2, technical: 0.6 },
      ruleTemperature: options.ruleTemperature || 22,
      ensembleWeights: options.ensembleWeights || { rule: 0.55, model: 0.45 },
      defaultThreshold: options.defaultThreshold || 0.6,
      minThreshold: options.minThreshold || 0.45,
      maxThreshold: options.maxThreshold || 0.75
    };

    this.model = null;
    this.modelKind = 'advanced';
    this.thresholds = {};
    this.thresholdManager = new AdaptiveThresholdManager({
      storagePath: this.config.thresholdsPath,
      bounds: [this.config.minThreshold, this.config.maxThreshold],
      defaultThreshold: this.config.defaultThreshold,
      autoload: true
    });
    this.featureKeys = [];
    this.modelReady = false;

    this._ensureDirectories();
    this.loadModel();
    this.refreshThresholdCache();
  }

  _ensureDirectories() {
    const modelDir = path.dirname(this.config.modelPath);
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }
    [this.config.thresholdsPath, this.config.shapSummaryPath].forEach((filePath) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  refreshThresholdCache() {
    this.thresholds = { ...this.thresholdManager.state.thresholds };
  }

  loadModel() {
    try {
      if (fs.existsSync(this.config.modelPath)) {
        const raw = fs.readFileSync(this.config.modelPath, 'utf8');
        const json = JSON.parse(raw);
        if (json?.type === 'AdvancedEnsembleModel' || json?.xgboost) {
          this.model = AdvancedEnsembleModel.fromJSON(json);
          this.featureKeys = this.model.featureKeys.slice();
          this.modelKind = 'advanced';
          this.modelReady = this._hasModelGeometry(this.model);
          return;
        }
        // Backward compatibility with legacy gradient boosting models
        this.model = GradientBoostingClassifier.fromJSON(json);
        this.featureKeys = json.featureKeys || [];
        this.modelKind = 'gradient-boosting';
        this.modelReady = this._hasModelGeometry(this.model);
        return;
      }
    } catch (err) {
      console.warn(
        'AdaptiveScorer: failed to load model, falling back to default stub',
        err.message
      );
    }

    this.model = new AdvancedEnsembleModel();
    this.modelKind = 'advanced';
    this.featureKeys = [];
    this.modelReady = false;
  }

  saveModel() {
    if (!this.model) {
      return;
    }
    const payload = this.model.toJSON ? this.model.toJSON() : this.model;
    fs.writeFileSync(this.config.modelPath, JSON.stringify(payload, null, 2), 'utf8');
    this.modelReady = this._hasModelGeometry(this.model);
  }

  saveThresholds() {
    this.thresholdManager.save();
    this.refreshThresholdCache();
  }

  getThreshold(pair) {
    return this.thresholdManager.getThreshold(pair);
  }

  score(pair, components) {
    const featureVector = this.extractFeatures(components);

    const ruleScore = this.computeRuleScore(components);
    const ruleProb = AdaptiveScorer.sigmoid(ruleScore / this.config.ruleTemperature);

    const modelActive = this.modelReady && this._hasModelGeometry(this.model);

    const modelExplained =
      this.model && typeof this.model.predictWithContributions === 'function'
        ? this.model.predictWithContributions(featureVector)
        : null;

    let modelProb =
      modelExplained?.probability ??
      (this.model && typeof this.model.predictProbability === 'function'
        ? this.model.predictProbability(featureVector)
        : ruleProb);

    if (!modelActive) {
      modelProb = ruleProb;
    }

    const totalWeight = this.config.ensembleWeights.rule + this.config.ensembleWeights.model;
    const ensembleProb =
      (ruleProb * this.config.ensembleWeights.rule +
        modelProb * this.config.ensembleWeights.model) /
      totalWeight;

    const thresholds = this.getThreshold(pair);
    let direction = 'NEUTRAL';
    if (ensembleProb >= thresholds.buy) {
      direction = 'BUY';
    } else if (ensembleProb <= thresholds.sell) {
      direction = 'SELL';
    }

    const finalScore = (ensembleProb - 0.5) * 200;
    const confidence = Math.min(99.5, Math.abs(ensembleProb - 0.5) * 190);

    const explanations = modelExplained?.contributions
      ? {
          baselineProbability:
            this.model?.baselineProbability ?? AdaptiveScorer.sigmoid(this.model?.baseScore ?? 0),
          topDrivers: this._rankContributions(modelExplained.contributions, 5),
          contributions: modelExplained.contributions,
          breakdown: modelExplained.breakdown || null
        }
      : null;

    const diagnostics = modelActive
      ? null
      : {
          modelReady: false,
          reason: 'model_untrained',
          message: 'Adaptive ensemble model not trained; using rule-based scoring only'
        };

    return {
      probability: ensembleProb,
      finalScore,
      ruleScore,
      ruleProbability: ruleProb,
      modelProbability: modelProb,
      thresholds,
      direction,
      confidence,
      features: featureVector,
      explanations,
      diagnostics
    };
  }

  extractFeatures({ economic, news, technical }) {
    const economicScore = this._normalize(economic?.relativeSentiment ?? 0, -100, 100);
    const economicDirection = AdaptiveScorer.directionToSigned(economic?.direction);

    const newsSentiment = this._normalize(news?.sentiment ?? 0, -50, 50);
    const newsDirection = AdaptiveScorer.directionToSigned(news?.direction);
    const newsImpact = this._normalize(news?.impact ?? 0, 0, 100);

    const technicalScore = this._normalize(technical?.score ?? 0, -150, 150);
    const technicalStrength = (technical?.strength ?? 0) / 100;
    const technicalDirection = AdaptiveScorer.directionToSigned(technical?.direction);

    const regimeConfidence =
      (technical?.regime?.confidence ?? technical?.regimeSummary?.confidence ?? 0) / 100;
    const regimeSlope =
      technical?.regime?.averageSlope ?? technical?.regimeSummary?.averageSlope ?? 0;

    const volatilityScore =
      (technical?.volatility?.averageScore ?? technical?.volatilitySummary?.averageScore ?? 0) /
      100;
    const volumePressure =
      (technical?.volumePressure?.averagePressure ??
        technical?.volumePressureSummary?.averagePressure ??
        0) / 100;
    const divergenceLoad = Math.min(
      (technical?.divergences?.total ?? technical?.divergenceSummary?.total ?? 0) / 6,
      1
    );

    const directionConsensus = (() => {
      if (!technical?.directionSummary) {
        return 0;
      }
      const buyVotes = Number(technical.directionSummary.BUY || 0);
      const sellVotes = Number(technical.directionSummary.SELL || 0);
      const total = buyVotes + sellVotes + Number(technical.directionSummary.NEUTRAL || 0);
      if (total === 0) return 0;
      return (buyVotes - sellVotes) / total;
    })();

    const features = {
      economicScore,
      economicDirection,
      newsSentiment,
      newsDirection,
      newsImpact,
      technicalScore,
      technicalStrength,
      technicalDirection,
      regimeConfidence,
      regimeSlope,
      volatilityScore,
      volumePressure,
      divergenceLoad,
      directionConsensus
    };

    if (this.featureKeys.length === 0) {
      this.featureKeys = Object.keys(features);
    }

    return features;
  }

  computeRuleScore({ economic, news, technical }) {
    const weights = this.config.ruleWeights;
    const economicScore = this._normalize(economic?.relativeSentiment ?? 0, -100, 100) * 100;
    const newsScore = this._normalize(news?.sentiment ?? 0, -50, 50) * 100;
    const technicalScore = technical?.score ?? 0;

    const rawScore =
      economicScore * weights.economic +
      newsScore * weights.news +
      technicalScore * weights.technical;
    return Math.max(-120, Math.min(120, rawScore));
  }

  static sigmoid(x) {
    if (x < -50) return 0;
    if (x > 50) return 1;
    return 1 / (1 + Math.exp(-x));
  }

  static directionToSigned(direction) {
    if (!direction) return 0;
    if (direction === 'BUY') return 1;
    if (direction === 'SELL') return -1;
    return 0;
  }

  _normalize(value, min, max) {
    const clamped = Math.max(min, Math.min(max, value));
    const normalized = (clamped - min) / (max - min || 1);
    return normalized * 2 - 1;
  }

  prepareTrainingDataset(records) {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .map((record) => {
        if (!record || typeof record !== 'object') {
          return null;
        }
        const features = this.extractFeatures(record.components || record);
        return {
          pair: record.pair || 'UNKNOWN',
          label: record.label ?? record.outcome ?? 0,
          features
        };
      })
      .filter(Boolean);
  }

  trainModel(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      throw new Error('AdaptiveScorer.trainModel requires a dataset');
    }

    const featureKeys = this.featureKeys.length
      ? this.featureKeys
      : Object.keys(dataset[0].features);
    const model = new AdvancedEnsembleModel();
    model.fit(dataset, featureKeys);
    this.model = model;
    this.modelKind = 'advanced';
    this.featureKeys = featureKeys;
    this.modelReady = this._hasModelGeometry(model);
    this.saveModel();
    return model;
  }

  optimizeThresholds(datasetByPair) {
    const updated = this.thresholdManager.bulkOptimize(datasetByPair, {
      minBound: this.config.minThreshold,
      maxBound: this.config.maxThreshold
    });
    this.refreshThresholdCache();
    return updated;
  }

  evaluateDataset(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return [];
    }

    return dataset.map((entry) => {
      const probability =
        this.model && typeof this.model.predictProbability === 'function'
          ? this.model.predictProbability(entry.features)
          : 0.5;
      return { ...entry, probability };
    });
  }

  generateShapSummary(dataset) {
    if (!this.model || typeof this.model.summarizeContributions !== 'function') {
      return null;
    }
    const summary = this.model.summarizeContributions(dataset);
    if (summary && this.config.shapSummaryPath) {
      fs.writeFileSync(this.config.shapSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
    }
    return summary;
  }

  _rankContributions(contributions, limit = 5) {
    const entries = Object.entries(contributions || {});
    if (!entries.length) {
      return [];
    }
    entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return entries.slice(0, limit).map(([feature, value]) => ({ feature, contribution: value }));
  }

  _hasModelGeometry(model) {
    if (!model) {
      return false;
    }
    if (Array.isArray(model.trees)) {
      return model.trees.length > 0;
    }
    if (typeof model.getTreeCount === 'function') {
      return model.getTreeCount() > 0;
    }
    if (Array.isArray(model.estimators)) {
      return model.estimators.length > 0;
    }
    if (model.xgbModel && Array.isArray(model.xgbModel.trees) && model.xgbModel.trees.length > 0) {
      return true;
    }
    if (
      model.lightgbmModel &&
      Array.isArray(model.lightgbmModel.trees) &&
      model.lightgbmModel.trees.length > 0
    ) {
      return true;
    }
    return false;
  }
}

export default AdaptiveScorer;
