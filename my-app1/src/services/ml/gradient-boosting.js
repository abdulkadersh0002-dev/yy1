class GradientBoostingClassifier {
  constructor(options = {}) {
    this.learningRate = options.learningRate ?? 0.1;
    this.nEstimators = options.nEstimators ?? 60;
    this.maxDepth = 1; // stumps for interpretability
    this.minSamplesLeaf = options.minSamplesLeaf ?? 8;
    this.featureKeys = [];
    this.baseScore = 0;
    this.trees = [];
  }

  static sigmoid(x) {
    if (x < -50) return 0;
    if (x > 50) return 1;
    return 1 / (1 + Math.exp(-x));
  }

  fit(dataset, featureKeys) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      throw new Error('GradientBoostingClassifier.fit requires a non-empty dataset');
    }

    this.featureKeys =
      Array.isArray(featureKeys) && featureKeys.length > 0
        ? featureKeys
        : Object.keys(dataset[0].features || {});

    const labels = dataset.map((row) => (row.label ? 1 : 0));
    const positiveRatio = labels.reduce((acc, val) => acc + val, 0) / labels.length;
    const clampedRatio = Math.min(Math.max(positiveRatio || 1e-4, 1e-4), 1 - 1e-4);
    this.baseScore = Math.log(clampedRatio / (1 - clampedRatio));

    const predictions = new Array(dataset.length).fill(this.baseScore);
    this.trees = [];

    for (let m = 0; m < this.nEstimators; m++) {
      const residuals = labels.map(
        (label, idx) => label - GradientBoostingClassifier.sigmoid(predictions[idx])
      );
      const tree = this._fitDecisionStump(dataset, residuals);
      if (!tree) {
        break;
      }

      this.trees.push(tree);

      for (let i = 0; i < dataset.length; i++) {
        const contribution = this.learningRate * this._evaluateTree(tree, dataset[i].features);
        predictions[i] += contribution;
      }

      const averageResidual =
        residuals.reduce((acc, val) => acc + Math.abs(val), 0) / residuals.length;
      if (averageResidual < 1e-4) {
        break;
      }
    }

    return {
      baseScore: this.baseScore,
      trees: this.trees,
      learningRate: this.learningRate,
      nEstimators: this.trees.length,
      featureKeys: this.featureKeys
    };
  }

  _fitDecisionStump(dataset, residuals) {
    let bestFeature = null;
    let bestThreshold = null;
    let bestScore = Infinity;
    let bestLeft = 0;
    let bestRight = 0;

    this.featureKeys.forEach((feature) => {
      const values = dataset.map((row) => Number(row.features[feature] ?? 0));
      const unique = Array.from(new Set(values)).sort((a, b) => a - b);
      if (unique.length <= 1) {
        return;
      }

      for (let i = 1; i < unique.length; i++) {
        const threshold = (unique[i - 1] + unique[i]) / 2;

        let leftSum = 0;
        let leftCount = 0;
        let rightSum = 0;
        let rightCount = 0;

        dataset.forEach((row, idx) => {
          const value = Number(row.features[feature] ?? 0);
          if (value <= threshold) {
            leftSum += residuals[idx];
            leftCount++;
          } else {
            rightSum += residuals[idx];
            rightCount++;
          }
        });

        if (leftCount < this.minSamplesLeaf || rightCount < this.minSamplesLeaf) {
          continue;
        }

        const leftMean = leftSum / leftCount;
        const rightMean = rightSum / rightCount;

        let loss = 0;
        dataset.forEach((row, idx) => {
          const value = Number(row.features[feature] ?? 0);
          const prediction = value <= threshold ? leftMean : rightMean;
          const diff = residuals[idx] - prediction;
          loss += diff * diff;
        });

        if (loss < bestScore) {
          bestScore = loss;
          bestFeature = feature;
          bestThreshold = threshold;
          bestLeft = leftMean;
          bestRight = rightMean;
        }
      }
    });

    if (!bestFeature) {
      return null;
    }

    return {
      feature: bestFeature,
      threshold: bestThreshold,
      left: bestLeft,
      right: bestRight
    };
  }

  _evaluateTree(tree, features) {
    if (!tree) return 0;
    const value = Number(features[tree.feature] ?? 0);
    return value <= tree.threshold ? tree.left : tree.right;
  }

  predictRaw(features) {
    let score = this.baseScore;
    for (const tree of this.trees) {
      score += this.learningRate * this._evaluateTree(tree, features);
    }
    return score;
  }

  predictProbability(features) {
    const raw = this.predictRaw(features);
    return GradientBoostingClassifier.sigmoid(raw);
  }

  toJSON() {
    return {
      baseScore: this.baseScore,
      learningRate: this.learningRate,
      nEstimators: this.trees.length,
      minSamplesLeaf: this.minSamplesLeaf,
      featureKeys: this.featureKeys,
      trees: this.trees
    };
  }

  static fromJSON(json) {
    const model = new GradientBoostingClassifier({
      learningRate: json.learningRate,
      nEstimators: json.nEstimators,
      minSamplesLeaf: json.minSamplesLeaf
    });
    model.baseScore = json.baseScore;
    model.trees = json.trees || [];
    model.featureKeys = json.featureKeys || [];
    return model;
  }
}

export default GradientBoostingClassifier;
