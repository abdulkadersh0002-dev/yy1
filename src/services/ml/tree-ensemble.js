const EPSILON = 1e-9;

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const sigmoid = (x) => {
  if (x < -50) {
    return 0;
  }
  if (x > 50) {
    return 1;
  }
  return 1 / (1 + Math.exp(-x));
};

const logit = (p) => {
  const clamped = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(clamped / (1 - clamped));
};

class GradientBoostedTreeEnsemble {
  constructor(options = {}) {
    this.learningRate = options.learningRate ?? 0.08;
    this.nEstimators = options.nEstimators ?? 80;
    this.minSamplesLeaf = options.minSamplesLeaf ?? 12;
    this.maxDepth = options.maxDepth ?? 3;
    this.subsample = clamp(options.subsample ?? 0.9, 0.1, 1);
    this.colsample = clamp(options.colsample ?? 0.8, 0.2, 1);
    this.lambda = options.lambda ?? 1;
    this.gamma = options.gamma ?? 0;
    this.minGain = options.minGain ?? 1e-4;
    this.maxLeafValue = options.maxLeafValue ?? 3.5;
    this.featureKeys = [];
    this.featureIndexMap = new Map();
    this.matrix = [];
    this.labels = [];
    this.sampleCount = 0;
    this.baseScore = 0;
    this.baseProbability = 0.5;
    this.trees = [];
    this.options = { ...options };
  }

  fit(dataset, featureKeys) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      throw new Error('GradientBoostedTreeEnsemble.fit requires a non-empty dataset');
    }

    this._prepareDataset(dataset, featureKeys);
    const rawScores = new Array(this.sampleCount).fill(this.baseScore);
    this.trees = [];

    for (let iter = 0; iter < this.nEstimators; iter++) {
      const gradients = new Array(this.sampleCount);
      const hessians = new Array(this.sampleCount);

      let gradientAccum = 0;
      for (let i = 0; i < this.sampleCount; i++) {
        const prob = sigmoid(rawScores[i]);
        const label = this.labels[i];
        const grad = prob - label;
        const hess = Math.max(prob * (1 - prob), EPSILON);
        gradients[i] = grad;
        hessians[i] = hess;
        gradientAccum += Math.abs(grad);
      }

      const averageGradient = gradientAccum / this.sampleCount;
      if (averageGradient < 1e-5) {
        break;
      }

      const sampleIndices = this._selectRowIndices();
      const featureIndices = this._selectFeatureIndices();
      const tree = this._buildTree({ gradients, hessians, sampleIndices, featureIndices });
      if (!tree) {
        break;
      }

      this.trees.push(tree);
      for (let i = 0; i < this.sampleCount; i++) {
        const leafValue = this._predictTreeForIndex(tree, i);
        rawScores[i] += this.learningRate * leafValue;
      }
    }

    return this;
  }

  predictRaw(features) {
    if (!features || this.featureKeys.length === 0) {
      return this.baseScore;
    }

    const vector = this._encodeFeatures(features);
    let raw = this.baseScore;
    for (const tree of this.trees) {
      raw += this.learningRate * this._predictTree(tree, vector);
    }
    return raw;
  }

  predictProbability(features) {
    return sigmoid(this.predictRaw(features));
  }

  predictWithContributions(features) {
    if (!features || this.featureKeys.length === 0) {
      const baseProbability = sigmoid(this.baseScore);
      return {
        raw: this.baseScore,
        probability: baseProbability,
        contributions: {}
      };
    }

    const vector = this._encodeFeatures(features);
    const contributions = {};
    let raw = this.baseScore;

    for (const tree of this.trees) {
      const { value, path } = this._predictTreeWithPath(tree, vector);
      raw += this.learningRate * value;
      if (path.length === 0) {
        continue;
      }
      const share = (this.learningRate * value) / path.length;
      for (const featureIndex of path) {
        const key = this.featureKeys[featureIndex];
        contributions[key] = (contributions[key] || 0) + share;
      }
    }

    return {
      raw,
      probability: sigmoid(raw),
      contributions
    };
  }

  summarizeContributions(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return [];
    }

    const aggregates = new Map();
    dataset.forEach((item) => {
      const explanation = this.predictWithContributions(item.features);
      Object.entries(explanation.contributions).forEach(([feature, value]) => {
        const entry = aggregates.get(feature) || { sum: 0, absSum: 0, count: 0 };
        entry.sum += value;
        entry.absSum += Math.abs(value);
        entry.count += 1;
        aggregates.set(feature, entry);
      });
    });

    const summary = Array.from(aggregates.entries()).map(([feature, stats]) => ({
      feature,
      meanContribution: stats.sum / stats.count,
      meanAbsContribution: stats.absSum / stats.count,
      importance: stats.absSum / dataset.length
    }));

    summary.sort((a, b) => b.meanAbsContribution - a.meanAbsContribution);
    return summary;
  }

  toJSON() {
    return {
      options: { ...this.options },
      featureKeys: this.featureKeys.slice(),
      baseScore: this.baseScore,
      baseProbability: this.baseProbability,
      trees: this.trees.map((tree) => this._serializeTree(tree))
    };
  }

  _serializeTree(node) {
    if (!node) {
      return null;
    }
    if (node.isLeaf) {
      return {
        leaf: true,
        value: node.value,
        gain: node.gain ?? 0,
        cover: node.cover ?? 0
      };
    }
    return {
      leaf: false,
      featureIndex: node.featureIndex,
      feature: this.featureKeys[node.featureIndex] ?? null,
      threshold: node.threshold,
      gain: node.gain ?? 0,
      cover: node.cover ?? 0,
      left: this._serializeTree(node.left),
      right: this._serializeTree(node.right)
    };
  }

  _prepareDataset(dataset, featureKeys) {
    this.featureKeys =
      Array.isArray(featureKeys) && featureKeys.length
        ? featureKeys.slice()
        : Object.keys(dataset[0]?.features || {});
    this.featureIndexMap = new Map();
    this.featureKeys.forEach((key, idx) => {
      this.featureIndexMap.set(key, idx);
    });

    this.sampleCount = dataset.length;
    this.matrix = new Array(this.sampleCount);
    this.labels = new Array(this.sampleCount);

    for (let row = 0; row < this.sampleCount; row++) {
      const item = dataset[row];
      const vector = new Array(this.featureKeys.length);
      for (let col = 0; col < this.featureKeys.length; col++) {
        const key = this.featureKeys[col];
        const value = Number(item.features?.[key] ?? 0);
        vector[col] = Number.isFinite(value) ? value : 0;
      }
      this.matrix[row] = vector;
      this.labels[row] = item.label ? 1 : 0;
    }

    const positives = this.labels.reduce((acc, label) => acc + label, 0);
    const ratio = clamp(positives / this.sampleCount || 1e-4, 1e-4, 1 - 1e-4);
    this.baseProbability = ratio;
    this.baseScore = logit(ratio);
  }

  _selectRowIndices() {
    if (this.subsample >= 0.999 || this.sampleCount <= this.minSamplesLeaf * 2) {
      return Array.from({ length: this.sampleCount }, (_, idx) => idx);
    }

    const target = Math.max(this.minSamplesLeaf * 4, Math.floor(this.subsample * this.sampleCount));
    const chosen = new Set();
    while (chosen.size < target) {
      const idx = Math.floor(Math.random() * this.sampleCount);
      chosen.add(idx);
    }
    return Array.from(chosen);
  }

  _selectFeatureIndices() {
    const featureCount = this.featureKeys.length;
    if (featureCount === 0 || this.colsample >= 0.999) {
      return Array.from({ length: featureCount }, (_, idx) => idx);
    }
    const target = Math.max(1, Math.floor(this.colsample * featureCount));
    const chosen = new Set();
    while (chosen.size < target) {
      const idx = Math.floor(Math.random() * featureCount);
      chosen.add(idx);
    }
    return Array.from(chosen);
  }

  _buildTree(/* context */) {
    throw new Error('_buildTree must be implemented by subclasses');
  }

  _createNode(indices, gradients, hessians, depth) {
    let gradSum = 0;
    let hessSum = 0;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      gradSum += gradients[idx];
      hessSum += hessians[idx];
    }

    return {
      depth,
      indices,
      gradientSum: gradSum,
      hessianSum: hessSum,
      value: this._valueFromStats(gradSum, hessSum),
      cover: indices.length,
      isLeaf: true,
      featureIndex: null,
      threshold: null,
      left: null,
      right: null,
      gain: 0
    };
  }

  _findBestSplit(node, gradients, hessians, featureIndices) {
    const candidates =
      Array.isArray(featureIndices) && featureIndices.length
        ? featureIndices
        : Array.from({ length: this.featureKeys.length }, (_, idx) => idx);

    let bestSplit = null;
    for (const featureIndex of candidates) {
      const candidate = this._findBestSplitForFeature(
        node.indices,
        gradients,
        hessians,
        featureIndex
      );
      if (!candidate) {
        continue;
      }
      if (!bestSplit || candidate.gain > bestSplit.gain) {
        bestSplit = { ...candidate, featureIndex };
      }
    }

    if (!bestSplit || bestSplit.gain <= this.minGain) {
      return null;
    }
    return bestSplit;
  }

  _findBestSplitForFeature(indices, gradients, hessians, featureIndex) {
    if (!indices || indices.length < this.minSamplesLeaf * 2) {
      return null;
    }

    const rows = indices
      .map((idx) => ({
        idx,
        value: this.matrix[idx][featureIndex],
        grad: gradients[idx],
        hess: hessians[idx]
      }))
      .sort((a, b) => a.value - b.value);

    const totalGrad = rows.reduce((acc, row) => acc + row.grad, 0);
    const totalHess = rows.reduce((acc, row) => acc + row.hess, 0);

    if (rows.length < this.minSamplesLeaf * 2) {
      return null;
    }

    let leftGrad = 0;
    let leftHess = 0;
    let leftCount = 0;
    let bestGain = -Infinity;
    let bestThreshold = null;
    let bestLeftCount = 0;

    for (let i = 0; i < rows.length - 1; i++) {
      leftGrad += rows[i].grad;
      leftHess += rows[i].hess;
      leftCount += 1;

      const rightCount = rows.length - leftCount;
      if (leftCount < this.minSamplesLeaf || rightCount < this.minSamplesLeaf) {
        continue;
      }

      const currentValue = rows[i].value;
      const nextValue = rows[i + 1].value;
      if (currentValue === nextValue) {
        continue;
      }

      const rightGrad = totalGrad - leftGrad;
      const rightHess = totalHess - leftHess;
      const gain = this._splitGain(totalGrad, totalHess, leftGrad, leftHess, rightGrad, rightHess);

      if (gain > bestGain + 1e-9) {
        bestGain = gain;
        bestThreshold = (currentValue + nextValue) / 2;
        bestLeftCount = leftCount;
      }
    }

    if (bestThreshold == null || bestGain <= this.minGain) {
      return null;
    }

    const leftIndices = rows.slice(0, bestLeftCount).map((row) => row.idx);
    const rightIndices = rows.slice(bestLeftCount).map((row) => row.idx);

    let leftGradSum = 0;
    let leftHessSum = 0;
    leftIndices.forEach((idx) => {
      leftGradSum += gradients[idx];
      leftHessSum += hessians[idx];
    });

    const rightGradSum = totalGrad - leftGradSum;
    const rightHessSum = totalHess - leftHessSum;

    return {
      gain: bestGain,
      threshold: bestThreshold,
      leftIndices,
      rightIndices,
      leftGrad: leftGradSum,
      leftHess: leftHessSum,
      rightGrad: rightGradSum,
      rightHess: rightHessSum
    };
  }

  _valueFromStats(gradientSum, hessianSum) {
    const denominator = hessianSum + this.lambda;
    if (Math.abs(denominator) < EPSILON) {
      return 0;
    }
    const raw = -gradientSum / denominator;
    return clamp(raw, -this.maxLeafValue, this.maxLeafValue);
  }

  _splitGain(totalGrad, totalHess, leftGrad, leftHess, rightGrad, rightHess) {
    const denom = totalHess + this.lambda;
    const leftDenom = leftHess + this.lambda;
    const rightDenom = rightHess + this.lambda;
    const parentScore = (totalGrad * totalGrad) / denom;
    const leftScore = (leftGrad * leftGrad) / leftDenom;
    const rightScore = (rightGrad * rightGrad) / rightDenom;
    return 0.5 * (leftScore + rightScore - parentScore) - this.gamma;
  }

  _createChildNode(parentNode, indices, gradSum, hessSum) {
    return {
      depth: parentNode.depth + 1,
      indices,
      gradientSum: gradSum,
      hessianSum: hessSum,
      value: this._valueFromStats(gradSum, hessSum),
      cover: indices.length,
      isLeaf: true,
      featureIndex: null,
      threshold: null,
      left: null,
      right: null,
      gain: 0
    };
  }

  _cleanupNode(node) {
    if (!node) {
      return;
    }
    delete node.indices;
    if (!node.isLeaf) {
      this._cleanupNode(node.left);
      this._cleanupNode(node.right);
    }
  }

  _predictTree(tree, vector) {
    let node = tree;
    while (node && !node.isLeaf) {
      const value = vector[node.featureIndex] ?? 0;
      node = value <= node.threshold ? node.left : node.right;
    }
    return node?.value ?? 0;
  }

  _predictTreeForIndex(tree, rowIndex) {
    const vector = this.matrix[rowIndex];
    return this._predictTree(tree, vector);
  }

  _predictTreeWithPath(tree, vector) {
    const path = [];
    let node = tree;
    while (node && !node.isLeaf) {
      path.push(node.featureIndex);
      const value = vector[node.featureIndex] ?? 0;
      node = value <= node.threshold ? node.left : node.right;
    }
    return {
      value: node?.value ?? 0,
      path
    };
  }

  _encodeFeatures(features) {
    const vector = new Array(this.featureKeys.length);
    for (let i = 0; i < this.featureKeys.length; i++) {
      const key = this.featureKeys[i];
      const value = Number(features[key] ?? 0);
      vector[i] = Number.isFinite(value) ? value : 0;
    }
    return vector;
  }

  static _deserializeTree(rawNode, featureKeys) {
    if (!rawNode) {
      return null;
    }
    if (rawNode.leaf) {
      return {
        isLeaf: true,
        value: rawNode.value,
        cover: rawNode.cover ?? 0,
        gain: rawNode.gain ?? 0
      };
    }
    const featureIndex = Number.isInteger(rawNode.featureIndex)
      ? rawNode.featureIndex
      : featureKeys.indexOf(rawNode.feature ?? '');
    return {
      isLeaf: false,
      featureIndex: Math.max(0, featureIndex),
      threshold: rawNode.threshold,
      gain: rawNode.gain ?? 0,
      cover: rawNode.cover ?? 0,
      left: GradientBoostedTreeEnsemble._deserializeTree(rawNode.left, featureKeys),
      right: GradientBoostedTreeEnsemble._deserializeTree(rawNode.right, featureKeys)
    };
  }
}

class XGBoostLikeClassifier extends GradientBoostedTreeEnsemble {
  constructor(options = {}) {
    super({
      learningRate: 0.09,
      nEstimators: 120,
      maxDepth: 4,
      minSamplesLeaf: 16,
      subsample: 0.85,
      colsample: 0.8,
      lambda: 1,
      gamma: 0.01,
      minGain: 1e-3,
      maxLeafValue: 3.5,
      ...options
    });
  }

  _buildTree({ gradients, hessians, sampleIndices, featureIndices }) {
    if (!Array.isArray(sampleIndices) || sampleIndices.length === 0) {
      return null;
    }
    const root = this._createNode(sampleIndices, gradients, hessians, 0);
    this._growDepthWise(root, gradients, hessians, featureIndices, 0);
    this._cleanupNode(root);
    return root;
  }

  _growDepthWise(node, gradients, hessians, featureIndices, depth) {
    if (!node || depth >= this.maxDepth) {
      return;
    }
    if (!Array.isArray(node.indices) || node.indices.length < this.minSamplesLeaf * 2) {
      return;
    }
    const split = this._findBestSplit(node, gradients, hessians, featureIndices);
    if (!split) {
      return;
    }

    node.isLeaf = false;
    node.featureIndex = split.featureIndex;
    node.threshold = split.threshold;
    node.gain = split.gain;

    node.left = this._createChildNode(node, split.leftIndices, split.leftGrad, split.leftHess);
    node.right = this._createChildNode(node, split.rightIndices, split.rightGrad, split.rightHess);

    this._growDepthWise(node.left, gradients, hessians, featureIndices, depth + 1);
    this._growDepthWise(node.right, gradients, hessians, featureIndices, depth + 1);
  }

  static fromJSON(json = {}) {
    const model = new XGBoostLikeClassifier(json.options || {});
    model.featureKeys = json.featureKeys || [];
    model.featureIndexMap = new Map();
    model.featureKeys.forEach((key, idx) => model.featureIndexMap.set(key, idx));
    model.baseScore = json.baseScore ?? 0;
    model.baseProbability = json.baseProbability ?? sigmoid(model.baseScore);
    model.trees = Array.isArray(json.trees)
      ? json.trees.map((tree) =>
          GradientBoostedTreeEnsemble._deserializeTree(tree, model.featureKeys)
        )
      : [];
    return model;
  }
}

class LightGBMLikeClassifier extends GradientBoostedTreeEnsemble {
  constructor(options = {}) {
    super({
      learningRate: 0.075,
      nEstimators: 140,
      maxDepth: options.maxDepth ?? 6,
      minSamplesLeaf: options.minSamplesLeaf ?? 12,
      subsample: options.subsample ?? 0.8,
      colsample: options.colsample ?? 0.9,
      lambda: options.lambda ?? 0.8,
      gamma: options.gamma ?? 0,
      minGain: options.minGain ?? 5e-4,
      maxLeafValue: options.maxLeafValue ?? 3.2
    });
    this.numLeaves = options.numLeaves ?? 16;
  }

  _buildTree({ gradients, hessians, sampleIndices, featureIndices }) {
    if (!Array.isArray(sampleIndices) || sampleIndices.length === 0) {
      return null;
    }
    const root = this._createNode(sampleIndices, gradients, hessians, 0);
    const leaves = [root];

    while (leaves.length < this.numLeaves) {
      let bestLeafIndex = -1;
      let bestSplit = null;

      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        if (!Array.isArray(leaf.indices) || leaf.indices.length < this.minSamplesLeaf * 2) {
          leaf.canSplit = false;
          continue;
        }
        if (leaf.depth >= this.maxDepth) {
          leaf.canSplit = false;
          continue;
        }
        const split = this._findBestSplit(leaf, gradients, hessians, featureIndices);
        if (!split) {
          leaf.canSplit = false;
          continue;
        }
        if (!bestSplit || split.gain > bestSplit.gain) {
          bestSplit = split;
          bestLeafIndex = i;
        }
      }

      if (!bestSplit || bestSplit.gain <= this.minGain || bestLeafIndex === -1) {
        break;
      }

      const targetLeaf = leaves[bestLeafIndex];
      targetLeaf.isLeaf = false;
      targetLeaf.featureIndex = bestSplit.featureIndex;
      targetLeaf.threshold = bestSplit.threshold;
      targetLeaf.gain = bestSplit.gain;

      const left = this._createChildNode(
        targetLeaf,
        bestSplit.leftIndices,
        bestSplit.leftGrad,
        bestSplit.leftHess
      );
      const right = this._createChildNode(
        targetLeaf,
        bestSplit.rightIndices,
        bestSplit.rightGrad,
        bestSplit.rightHess
      );

      targetLeaf.left = left;
      targetLeaf.right = right;

      leaves.splice(bestLeafIndex, 1, left, right);
    }

    this._cleanupNode(root);
    return root;
  }

  static fromJSON(json = {}) {
    const model = new LightGBMLikeClassifier(json.options || {});
    model.featureKeys = json.featureKeys || [];
    model.featureIndexMap = new Map();
    model.featureKeys.forEach((key, idx) => model.featureIndexMap.set(key, idx));
    model.baseScore = json.baseScore ?? 0;
    model.baseProbability = json.baseProbability ?? sigmoid(model.baseScore);
    model.trees = Array.isArray(json.trees)
      ? json.trees.map((tree) =>
          GradientBoostedTreeEnsemble._deserializeTree(tree, model.featureKeys)
        )
      : [];
    return model;
  }
}

class AdvancedEnsembleModel {
  constructor(options = {}) {
    const { xgboost = {}, lightgbm = {}, blending = {} } = options;
    this.xgbModel = new XGBoostLikeClassifier(xgboost);
    this.lightgbmModel = new LightGBMLikeClassifier(lightgbm);
    this.featureKeys = [];
    this.weights = {
      xgb: blending.xgbWeight ?? 0.55,
      lightgbm: blending.lightgbmWeight ?? 0.45
    };
    this.weightResolution = blending.weightResolution ?? 0.05;
    this.calibrationBias = 0;
    this.baselineProbability = 0.5;
    this.options = options;
  }

  fit(dataset, featureKeys) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      throw new Error('AdvancedEnsembleModel.fit requires a dataset');
    }
    this.featureKeys =
      Array.isArray(featureKeys) && featureKeys.length
        ? featureKeys.slice()
        : Object.keys(dataset[0]?.features || {});

    this.xgbModel.fit(dataset, this.featureKeys);
    this.lightgbmModel.fit(dataset, this.featureKeys);

    const positives = dataset.reduce((acc, item) => acc + (item.label ? 1 : 0), 0);
    const ratio = clamp(positives / dataset.length || 1e-4, 1e-4, 1 - 1e-4);
    this.baselineProbability = ratio;
    this.calibrationBias = logit(ratio);

    this._recalculateWeights(dataset);
    this._calibrateBias(dataset);
    return this;
  }

  predictProbability(features) {
    const raw = this._combinedRaw(features);
    return sigmoid(raw);
  }

  predictRaw(features) {
    return this._combinedRaw(features);
  }

  predictWithContributions(features) {
    const xgb = this.xgbModel.predictWithContributions(features);
    const lgb = this.lightgbmModel.predictWithContributions(features);

    const combined = {};
    Object.entries(xgb.contributions).forEach(([feature, value]) => {
      combined[feature] = (combined[feature] || 0) + this.weights.xgb * value;
    });
    Object.entries(lgb.contributions).forEach(([feature, value]) => {
      combined[feature] = (combined[feature] || 0) + this.weights.lightgbm * value;
    });

    const xgbComponent = this.xgbModel.predictRaw(features) - this.xgbModel.baseScore;
    const lgbComponent = this.lightgbmModel.predictRaw(features) - this.lightgbmModel.baseScore;
    const raw =
      this.calibrationBias + this.weights.xgb * xgbComponent + this.weights.lightgbm * lgbComponent;

    return {
      raw,
      probability: sigmoid(raw),
      contributions: combined,
      breakdown: {
        xgbProbability: xgb.probability,
        lightgbmProbability: lgb.probability,
        blendedProbability: sigmoid(raw),
        weights: { ...this.weights }
      }
    };
  }

  summarizeContributions(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return {
        baselineProbability: this.baselineProbability,
        weights: { ...this.weights },
        features: []
      };
    }

    const aggregates = new Map();
    dataset.forEach((item) => {
      const explanation = this.predictWithContributions(item.features);
      Object.entries(explanation.contributions).forEach(([feature, value]) => {
        const entry = aggregates.get(feature) || { sum: 0, absSum: 0, count: 0 };
        entry.sum += value;
        entry.absSum += Math.abs(value);
        entry.count += 1;
        aggregates.set(feature, entry);
      });
    });

    const summary = Array.from(aggregates.entries()).map(([feature, stats]) => ({
      feature,
      meanContribution: stats.sum / stats.count,
      meanAbsContribution: stats.absSum / stats.count,
      importance: stats.absSum / dataset.length
    }));
    summary.sort((a, b) => b.meanAbsContribution - a.meanAbsContribution);

    return {
      baselineProbability: this.baselineProbability,
      weights: { ...this.weights },
      features: summary
    };
  }

  toJSON() {
    return {
      type: 'AdvancedEnsembleModel',
      options: { ...this.options },
      featureKeys: this.featureKeys.slice(),
      weights: { ...this.weights },
      weightResolution: this.weightResolution,
      calibrationBias: this.calibrationBias,
      baselineProbability: this.baselineProbability,
      xgboost: this.xgbModel.toJSON(),
      lightgbm: this.lightgbmModel.toJSON()
    };
  }

  static fromJSON(json = {}) {
    const model = new AdvancedEnsembleModel(json.options || {});
    model.featureKeys = json.featureKeys || [];
    model.weights = json.weights || { xgb: 0.5, lightgbm: 0.5 };
    model.weightResolution = json.weightResolution ?? 0.05;
    model.calibrationBias = json.calibrationBias ?? 0;
    model.baselineProbability = json.baselineProbability ?? sigmoid(model.calibrationBias);
    model.xgbModel = XGBoostLikeClassifier.fromJSON(json.xgboost || {});
    model.lightgbmModel = LightGBMLikeClassifier.fromJSON(json.lightgbm || {});
    if (!model.featureKeys.length) {
      model.featureKeys = model.xgbModel.featureKeys.length
        ? model.xgbModel.featureKeys.slice()
        : model.lightgbmModel.featureKeys.slice();
    }
    return model;
  }

  _combinedRaw(features) {
    const xgbComponent = this.xgbModel.predictRaw(features) - this.xgbModel.baseScore;
    const lgbComponent = this.lightgbmModel.predictRaw(features) - this.lightgbmModel.baseScore;
    return (
      this.calibrationBias + this.weights.xgb * xgbComponent + this.weights.lightgbm * lgbComponent
    );
  }

  _recalculateWeights(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return;
    }

    const labels = dataset.map((item) => (item.label ? 1 : 0));
    const xgbProbs = dataset.map((item) => this.xgbModel.predictProbability(item.features));
    const lgbProbs = dataset.map((item) => this.lightgbmModel.predictProbability(item.features));

    const step = clamp(this.weightResolution, 0.01, 0.5);
    let bestWeight = this.weights.xgb;
    let bestLoss = Number.POSITIVE_INFINITY;

    for (let weight = 0; weight <= 1; weight = Math.min(weight + step, 1)) {
      const loss = this._logLoss(labels, xgbProbs, lgbProbs, weight);
      if (loss < bestLoss) {
        bestLoss = loss;
        bestWeight = weight;
      }
      if (weight === 1) {
        break;
      }
    }

    this.weights = { xgb: bestWeight, lightgbm: 1 - bestWeight };
  }

  _calibrateBias(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return;
    }
    const labels = dataset.map((item) => (item.label ? 1 : 0));
    const components = dataset.map((item) => {
      const xgbComponent = this.xgbModel.predictRaw(item.features) - this.xgbModel.baseScore;
      const lgbComponent =
        this.lightgbmModel.predictRaw(item.features) - this.lightgbmModel.baseScore;
      return this.weights.xgb * xgbComponent + this.weights.lightgbm * lgbComponent;
    });

    let bestBias = this.calibrationBias;
    let bestLoss = Number.POSITIVE_INFINITY;

    for (let offset = -1; offset <= 1; offset += 0.1) {
      const bias = this.calibrationBias + offset;
      const loss = this._logLossFromRaw(labels, components, bias);
      if (loss < bestLoss) {
        bestLoss = loss;
        bestBias = bias;
      }
    }

    this.calibrationBias = bestBias;
  }

  _logLoss(labels, xgbProbs, lgbProbs, weight) {
    let loss = 0;
    for (let i = 0; i < labels.length; i++) {
      const blended = clamp(weight * xgbProbs[i] + (1 - weight) * lgbProbs[i], 1e-6, 1 - 1e-6);
      const label = labels[i];
      loss += label ? -Math.log(blended) : -Math.log(1 - blended);
    }
    return loss / labels.length;
  }

  _logLossFromRaw(labels, components, bias) {
    let loss = 0;
    for (let i = 0; i < labels.length; i++) {
      const raw = bias + components[i];
      const prob = clamp(sigmoid(raw), 1e-6, 1 - 1e-6);
      const label = labels[i];
      loss += label ? -Math.log(prob) : -Math.log(1 - prob);
    }
    return loss / labels.length;
  }
}

export {
  GradientBoostedTreeEnsemble,
  XGBoostLikeClassifier,
  LightGBMLikeClassifier,
  AdvancedEnsembleModel
};
export default AdvancedEnsembleModel;
