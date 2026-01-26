import crypto from 'node:crypto';

class FeatureStore {
  constructor(options = {}) {
    this.maxPerKey = options.maxPerKey || 500;
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // default 24h
    this.store = new Map(); // key = `${pair}|${timeframe}` -> array of { ts, features }
    this.persistence = options.persistence || null;
    this.lastPersistedAt = null;
    this.totalPersisted = 0;
  }

  setPersistence(adapter) {
    this.persistence = adapter || null;
  }

  _key(pair, timeframe) {
    return `${pair}|${timeframe}`;
  }

  _splitKey(key) {
    const [pair = 'UNKNOWN', timeframe = 'M15'] = key.split('|');
    return { pair, timeframe };
  }

  _enforceRetention(key) {
    const arr = this.store.get(key);
    if (!arr || arr.length === 0) {
      return null;
    }

    const cutoff = Date.now() - this.ttlMs;
    let mutated = false;

    while (arr.length > 0 && arr[0].ts < cutoff) {
      arr.shift();
      mutated = true;
    }

    if (arr.length > this.maxPerKey) {
      arr.splice(0, arr.length - this.maxPerKey);
      mutated = true;
    }

    if (arr.length === 0) {
      this.store.delete(key);
      return null;
    }

    if (mutated) {
      this.store.set(key, arr);
    }

    return arr;
  }

  purgeExpired() {
    const keys = Array.from(this.store.keys());
    keys.forEach((key) => {
      this._enforceRetention(key);
    });
  }

  recordFeatures(pair, timeframe, features) {
    const key = this._key(pair, timeframe);
    const timestamp = features.timestamp || Date.now();
    const enriched = { ...features, pair, timeframe, timestamp };
    const entry = { ts: timestamp, pair, timeframe, features: enriched };

    const arr = this.store.get(key) || [];
    arr.push(entry);
    this.store.set(key, arr);
    this._enforceRetention(key);

    this.persistFeatureSnapshot(entry);
    return entry;
  }

  getLatest(pair, timeframe) {
    const key = this._key(pair, timeframe);
    const arr = this._enforceRetention(key);
    if (!arr || arr.length === 0) {
      return null;
    }
    return arr[arr.length - 1];
  }

  getRange(pair, timeframe, { sinceTs, limit = 100 } = {}) {
    const key = this._key(pair, timeframe);
    const arr = this._enforceRetention(key) || [];
    const filtered = sinceTs ? arr.filter((entry) => entry.ts >= sinceTs) : arr.slice();
    return filtered.slice(-limit);
  }

  getSnapshot(pair, { limitPerTimeframe = 50, sinceTs } = {}) {
    const summary = {
      pair,
      timeframes: {},
      updatedAt: Date.now()
    };

    for (const key of this.store.keys()) {
      const { pair: entryPair, timeframe } = this._splitKey(key);
      if (entryPair !== pair) {
        continue;
      }
      const arr = this._enforceRetention(key);
      if (!arr || arr.length === 0) {
        continue;
      }
      const filtered = sinceTs ? arr.filter((entry) => entry.ts >= sinceTs) : arr.slice();
      summary.timeframes[timeframe] = {
        latest: filtered.length ? filtered[filtered.length - 1] : null,
        history: filtered.slice(-limitPerTimeframe)
      };
    }

    return summary;
  }

  getAllLatest(limit = 100) {
    const entries = [];

    for (const key of this.store.keys()) {
      const arr = this._enforceRetention(key);
      if (!arr || arr.length === 0) {
        continue;
      }
      const { pair, timeframe } = this._splitKey(key);
      const latest = arr[arr.length - 1];
      entries.push({
        pair,
        timeframe,
        ts: latest.ts,
        features: latest.features
      });
    }

    entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return entries.slice(0, limit);
  }

  snapshotSummary() {
    const summary = {};
    for (const key of this.store.keys()) {
      const arr = this._enforceRetention(key);
      if (!arr || arr.length === 0) {
        continue;
      }
      summary[key] = {
        count: arr.length,
        first: arr[0]?.ts || null,
        last: arr[arr.length - 1]?.ts || null
      };
    }
    return summary;
  }

  getStats(limit = 20) {
    const entries = [];
    let totalEntries = 0;

    for (const key of this.store.keys()) {
      const arr = this._enforceRetention(key);
      if (!arr || arr.length === 0) {
        continue;
      }
      const last = arr[arr.length - 1] || null;
      const { pair, timeframe } = this._splitKey(key);
      totalEntries += arr.length;
      entries.push({
        key,
        pair,
        timeframe,
        count: arr.length,
        lastTs: last?.ts || null,
        price: last?.features?.price ?? null,
        score: last?.features?.score ?? null
      });
    }

    entries.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

    return {
      totalKeys: entries.length,
      totalEntries,
      recent: entries.slice(0, limit)
    };
  }

  getPersistenceStatus() {
    return {
      enabled: Boolean(this.persistence),
      lastPersistedAt: this.lastPersistedAt ? new Date(this.lastPersistedAt).toISOString() : null,
      totalPersisted: this.totalPersisted
    };
  }

  buildFeatureHash(features) {
    try {
      const orderedKeys = Object.keys(features).sort();
      const normalized = JSON.stringify(features, orderedKeys);
      return crypto.createHash('sha256').update(normalized).digest('hex');
    } catch (error) {
      return null;
    }
  }

  persistFeatureSnapshot(entry) {
    if (!this.persistence || typeof this.persistence.recordFeatureSnapshot !== 'function') {
      return;
    }

    const capturedAtMs = Number.isFinite(entry.ts) ? entry.ts : Date.now();
    const capturedAt = new Date(capturedAtMs);
    const features = { ...entry.features };

    const payload = {
      pair: entry.pair,
      timeframe: entry.timeframe,
      capturedAt,
      featureHash: this.buildFeatureHash(features),
      features,
      strength: Number.isFinite(features.score) ? Number(features.score) : null,
      confidence: Number.isFinite(features.regimeConfidence)
        ? Number(features.regimeConfidence)
        : null,
      direction: features.direction || null,
      metadata: {
        price: Number.isFinite(features.price) ? Number(features.price) : null,
        regime: features.regime || null,
        volatilityState: features.volatilityState || null,
        volumePressure: Number.isFinite(features.volumePressure)
          ? Number(features.volumePressure)
          : null,
        volumeImbalance: Number.isFinite(features.volumeImbalance)
          ? Number(features.volumeImbalance)
          : null,
        volumeZScore: Number.isFinite(features.volumeZScore) ? Number(features.volumeZScore) : null,
        volumeRate: Number.isFinite(features.volumeRate) ? Number(features.volumeRate) : null,
        priceDeltaPct: Number.isFinite(features.priceDeltaPct)
          ? Number(features.priceDeltaPct)
          : null,
        divergenceCount: Number.isFinite(features.divergenceCount)
          ? Number(features.divergenceCount)
          : null,
        patternCount: Number.isFinite(features.patternCount) ? Number(features.patternCount) : null
      }
    };

    this.persistence
      .recordFeatureSnapshot(payload)
      .then((success) => {
        if (success) {
          this.lastPersistedAt = capturedAt.getTime();
          this.totalPersisted += 1;
        }
      })
      .catch(() => {
        // Swallow persistence errors; adapter already logs failures.
      });
  }
}

export default FeatureStore;
