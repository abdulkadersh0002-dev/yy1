import fs from 'fs';
import path from 'path';
import BayesianOptimizer from './bayesian-optimizer.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sampleGamma = (shape) => {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    // rejection sampling
    let x;
    let v;
    do {
      x = (Math.random() * 2 - 1) * Math.sqrt(9 * d);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    const condition1 = u < 1 - 0.331 * Math.pow(x, 4);
    const condition2 = Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v));
    if (condition1 || condition2) {
      return d * v;
    }
  }
};

class BetaBandit {
  constructor(alpha = 3, beta = 2) {
    this.alpha = alpha;
    this.beta = beta;
  }

  sample() {
    const x = sampleGamma(this.alpha);
    const y = sampleGamma(this.beta);
    if (x + y === 0) {
      return this.expectedValue();
    }
    return x / (x + y);
  }

  expectedValue() {
    return this.alpha / (this.alpha + this.beta);
  }

  update(successes = 0, failures = 0) {
    if (Number.isFinite(successes) && successes > 0) {
      this.alpha += successes;
    }
    if (Number.isFinite(failures) && failures > 0) {
      this.beta += failures;
    }
  }

  toJSON() {
    return {
      alpha: this.alpha,
      beta: this.beta
    };
  }

  static fromJSON(json, fallback) {
    const alpha = Number.isFinite(json?.alpha) ? json.alpha : fallback.alpha;
    const beta = Number.isFinite(json?.beta) ? json.beta : fallback.beta;
    return new BetaBandit(alpha, beta);
  }
}

class AdaptiveThresholdManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath ? path.resolve(options.storagePath) : null;
    this.bounds = options.bounds ?? [0.45, 0.75];
    this.defaultThreshold = options.defaultThreshold ?? 0.6;
    this.banditPrior = options.banditPrior || { alpha: 3, beta: 2 };
    this.minSamples = options.minSamples ?? 12;
    this.optimizerOptions = options.optimizer || { iterations: 18, exploration: 0.01 };
    this.state = {
      thresholds: {},
      bandits: {},
      metadata: {
        updatedAt: null,
        totalOptimizations: 0
      }
    };

    if (options.autoload !== false) {
      this.load();
    }
  }

  load() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const json = JSON.parse(raw);
      this.state.thresholds = json.thresholds || {};
      this.state.bandits = {};
      Object.entries(json.bandits || {}).forEach(([pair, entry]) => {
        this.state.bandits[pair] = {
          buy: BetaBandit.fromJSON(entry.buy, this.banditPrior),
          sell: BetaBandit.fromJSON(entry.sell, this.banditPrior)
        };
      });
      this.state.metadata = json.metadata || this.state.metadata;
    } catch (error) {
      console.warn('AdaptiveThresholdManager: failed to load thresholds', error.message);
    }
  }

  save() {
    if (!this.storagePath) {
      return;
    }
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      thresholds: this.state.thresholds,
      bandits: Object.fromEntries(
        Object.entries(this.state.bandits).map(([pair, entry]) => [
          pair,
          {
            buy: entry.buy.toJSON(),
            sell: entry.sell.toJSON()
          }
        ])
      ),
      metadata: {
        ...this.state.metadata,
        updatedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  getThreshold(pair) {
    const entry = this.state.thresholds[pair];
    if (entry && typeof entry.buy === 'number' && typeof entry.sell === 'number') {
      return {
        buy: entry.buy,
        sell: entry.sell,
        score: entry.score ?? null
      };
    }
    const defaultSell = 1 - this.defaultThreshold;
    return {
      buy: this.defaultThreshold,
      sell: clamp(defaultSell, this.bounds[0], this.bounds[1]),
      score: null
    };
  }

  bulkOptimize(datasetByPair = {}, options = {}) {
    const updated = {};
    const bounds = [
      Number.isFinite(options.minBound) ? options.minBound : this.bounds[0],
      Number.isFinite(options.maxBound) ? options.maxBound : this.bounds[1]
    ];
    const iterations = options.iterations ?? this.optimizerOptions.iterations ?? 18;
    const exploration = options.exploration ?? this.optimizerOptions.exploration ?? 0.01;

    Object.entries(datasetByPair).forEach(([pair, samples]) => {
      if (!Array.isArray(samples) || samples.length < this.minSamples) {
        return;
      }

      const optimizer = new BayesianOptimizer({ bounds, exploration });
      const bandit = this._getBandit(pair);
      const existing = this.state.thresholds[pair];

      const initialPoints = [];
      if (existing?.buy) {
        initialPoints.push(existing.buy);
      }
      initialPoints.push(clamp(bandit.buy.sample(), bounds[0], bounds[1]));
      initialPoints.push(clamp(bandit.buy.expectedValue(), bounds[0], bounds[1]));

      const evaluate = (threshold) => this._scoreThreshold(samples, threshold);
      const {
        best,
        value,
        samples: explored
      } = optimizer.optimize({
        evaluate,
        initialPoints,
        iterations
      });

      const buy = clamp(best, bounds[0], bounds[1]);
      const sell = clamp(1 - buy, bounds[0], bounds[1]);
      const metrics = this._evaluateSamples(samples, buy);

      this._setThreshold(pair, { buy, sell, score: value, metrics, explored });
      this._updateBandit(pair, metrics);

      updated[pair] = {
        buy,
        sell,
        score: Number(value.toFixed(4)),
        explored,
        metrics
      };
    });

    if (Object.keys(updated).length > 0) {
      this.state.metadata.totalOptimizations += 1;
      this.state.metadata.updatedAt = new Date().toISOString();
      this.save();
    }

    return updated;
  }

  recordObservation(pair, probability, label, threshold) {
    const prediction = probability >= (threshold?.buy ?? this.getThreshold(pair).buy) ? 1 : 0;
    const bandit = this._getBandit(pair);
    if (prediction === 1) {
      bandit.buy.update(label ? 1 : 0, label ? 0 : 1);
    } else {
      bandit.sell.update(label ? 0 : 1, label ? 1 : 0);
    }
    this.save();
  }

  _setThreshold(pair, payload) {
    this.state.thresholds[pair] = {
      buy: Number(payload.buy.toFixed(4)),
      sell: Number(payload.sell.toFixed(4)),
      score: Number((payload.score ?? 0).toFixed(4)),
      metrics: payload.metrics,
      explored: payload.explored || []
    };
  }

  _getBandit(pair) {
    if (!this.state.bandits[pair]) {
      this.state.bandits[pair] = {
        buy: new BetaBandit(this.banditPrior.alpha, this.banditPrior.beta),
        sell: new BetaBandit(this.banditPrior.alpha, this.banditPrior.beta)
      };
    }
    return this.state.bandits[pair];
  }

  _scoreThreshold(samples, threshold) {
    const metrics = this._evaluateSamples(samples, threshold);
    const { f1, accuracy } = metrics;
    return f1 * 0.7 + accuracy * 0.3;
  }

  _evaluateSamples(samples, threshold) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;

    samples.forEach((sample) => {
      const probability = Number(sample.probability ?? sample.modelProbability ?? 0.5);
      const label = sample.label ? 1 : 0;
      const prediction = probability >= threshold ? 1 : 0;
      if (prediction === 1 && label === 1) tp += 1;
      if (prediction === 1 && label === 0) fp += 1;
      if (prediction === 0 && label === 0) tn += 1;
      if (prediction === 0 && label === 1) fn += 1;
    });

    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const accuracy = (tp + tn) / Math.max(1, tp + tn + fp + fn);

    return {
      tp,
      fp,
      tn,
      fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      accuracy: Number(accuracy.toFixed(4))
    };
  }

  _updateBandit(pair, metrics) {
    const bandit = this._getBandit(pair);
    bandit.buy.update(metrics.tp, metrics.fp);
    bandit.sell.update(metrics.tn, metrics.fn);
  }

  toJSON() {
    return {
      thresholds: this.state.thresholds,
      bandits: Object.fromEntries(
        Object.entries(this.state.bandits).map(([pair, entry]) => [
          pair,
          {
            buy: entry.buy.toJSON(),
            sell: entry.sell.toJSON()
          }
        ])
      ),
      metadata: this.state.metadata
    };
  }
}

export default AdaptiveThresholdManager;
