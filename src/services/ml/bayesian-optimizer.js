class GaussianProcess1D {
  constructor(lengthScale = 0.12, noise = 1e-6) {
    this.lengthScale = lengthScale;
    this.noise = noise;
    this.x = [];
    this.y = [];
    this.L = null;
  }

  kernel(a, b) {
    const diff = a - b;
    return Math.exp(-(diff * diff) / (2 * this.lengthScale * this.lengthScale));
  }

  update(xVals, yVals) {
    this.x = xVals.slice();
    this.y = yVals.slice();
    const n = this.x.length;
    const K = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        K[i][j] = this.kernel(this.x[i], this.x[j]);
      }
      K[i][i] += this.noise;
    }

    this.L = this._cholesky(K);
  }

  _cholesky(matrix) {
    const n = matrix.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = matrix[i][j];
        for (let k = 0; k < j; k++) {
          sum -= L[i][k] * L[j][k];
        }
        if (i === j) {
          L[i][j] = Math.sqrt(Math.max(sum, 1e-12));
        } else {
          L[i][j] = sum / L[j][j];
        }
      }
    }
    return L;
  }

  predict(xStar) {
    if (!this.L || this.x.length === 0) {
      return { mean: 0, variance: 1 };
    }

    const kStar = this.x.map((xi) => this.kernel(xi, xStar));

    const alpha = this._solveLinearSystem(this.L, this.y);

    let mean = 0;
    for (let i = 0; i < kStar.length; i++) {
      mean += kStar[i] * alpha[i];
    }

    const v = this._solveLowerTriangular(this.L, kStar);
    let variance = 1 - v.reduce((acc, val) => acc + val * val, 0);
    variance = Math.max(variance, 1e-6);

    return { mean, variance };
  }

  _solveLowerTriangular(L, b) {
    const y = new Array(b.length).fill(0);
    for (let i = 0; i < L.length; i++) {
      let sum = b[i];
      for (let k = 0; k < i; k++) {
        sum -= L[i][k] * y[k];
      }
      y[i] = sum / L[i][i];
    }
    return y;
  }

  _solveLinearSystem(L, b) {
    const y = this._solveLowerTriangular(L, b);
    const x = new Array(b.length).fill(0);
    for (let i = L.length - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < L.length; k++) {
        sum -= L[k][i] * x[k];
      }
      x[i] = sum / L[i][i];
    }
    return x;
  }
}

class BayesianOptimizer {
  constructor(options = {}) {
    this.bounds = options.bounds ?? [0.45, 0.75];
    this.exploration = options.exploration ?? 0.01;
    this.kernel = new GaussianProcess1D(options.lengthScale ?? 0.08, options.noise ?? 1e-5);
  }

  expectedImprovement(mean, variance, best) {
    const std = Math.sqrt(Math.max(variance, 1e-12));
    if (std === 0) {
      return 0;
    }
    const z = (mean - best - this.exploration) / std;
    const cdf = 0.5 * (1 + this._erf(z / Math.sqrt(2)));
    const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return (mean - best - this.exploration) * cdf + std * pdf;
  }

  _erf(x) {
    const sign = x >= 0 ? 1 : -1;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const absX = Math.abs(x);
    const t = 1 / (1 + p * absX);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return sign * y;
  }

  optimize({ evaluate, initialPoints = [], iterations = 18 }) {
    if (typeof evaluate !== 'function') {
      throw new Error('BayesianOptimizer.optimize requires an evaluation function');
    }

    const samples = [];
    const values = [];

    const [minBound, maxBound] = this.bounds;
    const seeded = initialPoints.length
      ? initialPoints
      : [minBound, maxBound, (minBound + maxBound) / 2];

    seeded.forEach((point) => {
      const clamped = Math.min(Math.max(point, minBound), maxBound);
      if (!samples.includes(clamped)) {
        const value = evaluate(clamped);
        samples.push(clamped);
        values.push(value);
      }
    });

    let bestValue = Math.max(...values);
    let bestPoint = samples[values.indexOf(bestValue)];

    for (let iter = 0; iter < iterations; iter++) {
      this.kernel.update(samples, values);

      let bestEi = -Infinity;
      let candidate = null;

      const grid = 60;
      for (let i = 0; i <= grid; i++) {
        const point = minBound + (i / grid) * (maxBound - minBound);
        if (samples.includes(point)) {
          continue;
        }
        const { mean, variance } = this.kernel.predict(point);
        const improvement = this.expectedImprovement(mean, variance, bestValue);
        if (improvement > bestEi) {
          bestEi = improvement;
          candidate = point;
        }
      }

      if (candidate == null) {
        break;
      }

      const value = evaluate(candidate);
      samples.push(candidate);
      values.push(value);

      if (value > bestValue) {
        bestValue = value;
        bestPoint = candidate;
      }
    }

    return {
      best: bestPoint,
      value: bestValue,
      samples,
      values
    };
  }
}

export default BayesianOptimizer;
