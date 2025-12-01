/**
 * In-Memory Cache Service
 *
 * A high-performance caching layer with TTL support, LRU eviction,
 * and namespace isolation. Drop-in replacement ready for Redis.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SIZE = 10000; // Max entries before eviction
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * LRU Cache Entry
 */
class CacheEntry {
  constructor(key, value, ttlMs) {
    this.key = key;
    this.value = value;
    this.expiresAt = Date.now() + ttlMs;
    this.lastAccessed = Date.now();
    this.hits = 0;
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }

  touch() {
    this.lastAccessed = Date.now();
    this.hits++;
  }
}

/**
 * Cache Statistics
 */
class CacheStats {
  constructor() {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  get hitRate() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  toJSON() {
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: (this.hitRate * 100).toFixed(2) + '%'
    };
  }
}

/**
 * In-Memory Cache with TTL and LRU eviction
 */
export default class CacheService {
  constructor(options = {}) {
    this.namespace = options.namespace || 'default';
    this.defaultTtlMs = options.ttlMs || DEFAULT_TTL_MS;
    this.maxSize = options.maxSize || DEFAULT_MAX_SIZE;
    this.cache = new Map();
    this.stats = new CacheStats();
    this.logger = options.logger || console;

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Prevent cleanup from keeping process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Generate namespaced key
   */
  _key(key) {
    return `${this.namespace}:${key}`;
  }

  /**
   * Get value from cache
   */
  get(key) {
    const fullKey = this._key(key);
    const entry = this.cache.get(fullKey);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (entry.isExpired()) {
      this.cache.delete(fullKey);
      this.stats.misses++;
      this.stats.expirations++;
      return null;
    }

    entry.touch();
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    const fullKey = this._key(key);

    // Check if we need to evict before adding (check namespace size)
    if (this.size() >= this.maxSize && !this.cache.has(fullKey)) {
      this._evictLRU();
    }

    const entry = new CacheEntry(key, value, ttlMs);
    this.cache.set(fullKey, entry);
    this.stats.sets++;

    return true;
  }

  /**
   * Delete value from cache
   */
  delete(key) {
    const fullKey = this._key(key);
    const deleted = this.cache.delete(fullKey);

    if (deleted) {
      this.stats.deletes++;
    }

    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    const fullKey = this._key(key);
    const entry = this.cache.get(fullKey);

    if (!entry) return false;
    if (entry.isExpired()) {
      this.cache.delete(fullKey);
      this.stats.expirations++;
      return false;
    }

    return true;
  }

  /**
   * Get or set with callback
   */
  async getOrSet(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    if (value !== null && value !== undefined) {
      this.set(key, value, ttlMs);
    }

    return value;
  }

  /**
   * Clear all entries in this namespace
   */
  clear() {
    const prefix = `${this.namespace}:`;
    let cleared = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get cache size for this namespace
   */
  size() {
    const prefix = `${this.namespace}:`;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      ...this.stats.toJSON(),
      size: this.size(),
      maxSize: this.maxSize,
      namespace: this.namespace
    };
  }

  /**
   * Evict least recently used entry in this namespace
   */
  _evictLRU() {
    const prefix = `${this.namespace}:`;
    let oldestEntry = null;
    let oldestKey = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!key.startsWith(prefix)) continue;

      if (!oldestEntry || entry.lastAccessed < oldestEntry.lastAccessed) {
        oldestEntry = entry;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.isExpired()) {
        this.cache.delete(key);
        this.stats.expirations++;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug?.({ cleaned, namespace: this.namespace }, 'Cache cleanup completed');
    }

    return cleaned;
  }

  /**
   * Stop the cache service
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all keys in this namespace
   */
  keys() {
    const prefix = `${this.namespace}:`;
    const keys = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key.slice(prefix.length));
      }
    }

    return keys;
  }

  /**
   * Multi-get operation
   */
  mget(keys) {
    const results = {};
    for (const key of keys) {
      results[key] = this.get(key);
    }
    return results;
  }

  /**
   * Multi-set operation
   */
  mset(entries, ttlMs = this.defaultTtlMs) {
    for (const [key, value] of Object.entries(entries)) {
      this.set(key, value, ttlMs);
    }
    return true;
  }
}

/**
 * Create namespace-isolated cache instances
 */
export function createCacheFactory(globalOptions = {}) {
  const sharedCache = new Map();
  const instances = new Map();

  return {
    /**
     * Get or create a cache instance for a namespace
     */
    getCache(namespace, options = {}) {
      if (instances.has(namespace)) {
        return instances.get(namespace);
      }

      const cache = new CacheService({
        ...globalOptions,
        ...options,
        namespace
      });

      // Share the underlying map for memory efficiency
      cache.cache = sharedCache;
      instances.set(namespace, cache);

      return cache;
    },

    /**
     * Get global statistics
     */
    getGlobalStats() {
      const stats = {
        totalSize: sharedCache.size,
        namespaces: {}
      };

      for (const [namespace, cache] of instances.entries()) {
        stats.namespaces[namespace] = cache.getStats();
      }

      return stats;
    },

    /**
     * Clear all caches
     */
    clearAll() {
      sharedCache.clear();
    },

    /**
     * Stop all cache instances
     */
    stopAll() {
      for (const cache of instances.values()) {
        cache.stop();
      }
      instances.clear();
    }
  };
}
