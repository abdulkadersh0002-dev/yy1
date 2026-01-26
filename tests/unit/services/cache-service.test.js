/**
 * Unit tests for Cache Service
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import CacheService, { createCacheFactory } from '../../../src/infrastructure/services/cache-service.js';

describe('Cache Service', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheService({ namespace: 'test', ttlMs: 5000 });
  });

  afterEach(() => {
    cache.stop();
  });

  describe('Basic Operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      const result = cache.get('key1');
      assert.strictEqual(result, 'value1');
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('nonexistent');
      assert.strictEqual(result, null);
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      cache.delete('key1');
      const result = cache.get('key1');
      assert.strictEqual(result, null);
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      assert.strictEqual(cache.has('key1'), true);
      assert.strictEqual(cache.has('nonexistent'), false);
    });

    it('should clear all entries in namespace', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      assert.strictEqual(cache.size(), 0);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortCache = new CacheService({ namespace: 'short', ttlMs: 50 });
      shortCache.set('expire', 'soon');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = shortCache.get('expire');
      assert.strictEqual(result, null);
      shortCache.stop();
    });

    it('should support custom TTL per entry', async () => {
      cache.set('quick', 'value', 50);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = cache.get('quick');
      assert.strictEqual(result, null);
    });

    it('should not expire entries before TTL', () => {
      cache.set('persist', 'value', 10000);
      const result = cache.get('persist');
      assert.strictEqual(result, 'value');
    });
  });

  describe('Object and Array Values', () => {
    it('should cache objects', () => {
      const obj = { name: 'test', value: 123 };
      cache.set('obj', obj);
      const result = cache.get('obj');
      assert.deepStrictEqual(result, obj);
    });

    it('should cache arrays', () => {
      const arr = [1, 2, 3, 'four'];
      cache.set('arr', arr);
      const result = cache.get('arr');
      assert.deepStrictEqual(result, arr);
    });

    it('should cache complex nested structures', () => {
      const complex = {
        array: [1, 2, { nested: true }],
        object: { deep: { value: 'test' } }
      };
      cache.set('complex', complex);
      const result = cache.get('complex');
      assert.deepStrictEqual(result, complex);
    });
  });

  describe('Statistics', () => {
    it('should track cache hits', () => {
      cache.set('key', 'value');
      cache.get('key');
      cache.get('key');

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
    });

    it('should track cache misses', () => {
      cache.get('nonexistent1');
      cache.get('nonexistent2');

      const stats = cache.getStats();
      assert.strictEqual(stats.misses, 2);
    });

    it('should calculate hit rate', () => {
      cache.set('key', 'value');
      cache.get('key'); // hit
      cache.get('miss'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hitRate, '50.00%');
    });

    it('should track sets and deletes', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.delete('key1');

      const stats = cache.getStats();
      assert.strictEqual(stats.sets, 2);
      assert.strictEqual(stats.deletes, 1);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('cached', 'original');

      let fetchCalled = false;
      const result = await cache.getOrSet('cached', async () => {
        fetchCalled = true;
        return 'new';
      });

      assert.strictEqual(result, 'original');
      assert.strictEqual(fetchCalled, false);
    });

    it('should call fetch function if not cached', async () => {
      let fetchCalled = false;
      const result = await cache.getOrSet('new', async () => {
        fetchCalled = true;
        return 'fetched';
      });

      assert.strictEqual(result, 'fetched');
      assert.strictEqual(fetchCalled, true);
    });

    it('should cache the fetched value', async () => {
      await cache.getOrSet('fetchOnce', async () => 'fetched');

      let fetchCalledAgain = false;
      const result = await cache.getOrSet('fetchOnce', async () => {
        fetchCalledAgain = true;
        return 'new';
      });

      assert.strictEqual(result, 'fetched');
      assert.strictEqual(fetchCalledAgain, false);
    });
  });

  describe('Multi Operations', () => {
    it('should get multiple values', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const results = cache.mget(['a', 'b', 'c']);

      assert.strictEqual(results.a, 1);
      assert.strictEqual(results.b, 2);
      assert.strictEqual(results.c, null);
    });

    it('should set multiple values', () => {
      cache.mset({ x: 10, y: 20, z: 30 });

      assert.strictEqual(cache.get('x'), 10);
      assert.strictEqual(cache.get('y'), 20);
      assert.strictEqual(cache.get('z'), 30);
    });
  });

  describe('Keys Operation', () => {
    it('should return all keys in namespace', () => {
      cache.set('key1', 'v1');
      cache.set('key2', 'v2');
      cache.set('key3', 'v3');

      const keys = cache.keys();
      assert.strictEqual(keys.length, 3);
      assert.ok(keys.includes('key1'));
      assert.ok(keys.includes('key2'));
      assert.ok(keys.includes('key3'));
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used when max size reached', async () => {
      const smallCache = new CacheService({
        namespace: 'small',
        maxSize: 3
      });

      smallCache.set('first', 1);
      await new Promise((r) => setTimeout(r, 5));
      smallCache.set('second', 2);
      await new Promise((r) => setTimeout(r, 5));
      smallCache.set('third', 3);
      await new Promise((r) => setTimeout(r, 5));

      // Access first and second to make them more recent
      smallCache.get('first');
      await new Promise((r) => setTimeout(r, 5));
      smallCache.get('second');
      await new Promise((r) => setTimeout(r, 5));

      // This should evict 'third' (least recently accessed)
      smallCache.set('fourth', 4);

      assert.strictEqual(smallCache.get('first'), 1);
      assert.strictEqual(smallCache.get('second'), 2);
      assert.strictEqual(smallCache.get('third'), null); // Evicted
      assert.strictEqual(smallCache.get('fourth'), 4);

      // Stats should show eviction
      const stats = smallCache.getStats();
      assert.ok(stats.evictions >= 1);

      smallCache.stop();
    });
  });
});

describe('Cache Factory', () => {
  let factory;

  beforeEach(() => {
    factory = createCacheFactory({ ttlMs: 5000 });
  });

  afterEach(() => {
    factory.stopAll();
  });

  it('should create isolated namespace caches', () => {
    const userCache = factory.getCache('users');
    const productCache = factory.getCache('products');

    userCache.set('id', 'user-123');
    productCache.set('id', 'product-456');

    assert.strictEqual(userCache.get('id'), 'user-123');
    assert.strictEqual(productCache.get('id'), 'product-456');
  });

  it('should return same instance for same namespace', () => {
    const cache1 = factory.getCache('test');
    const cache2 = factory.getCache('test');

    assert.strictEqual(cache1, cache2);
  });

  it('should provide global statistics', () => {
    const cache1 = factory.getCache('ns1');
    const cache2 = factory.getCache('ns2');

    cache1.set('key', 'value');
    cache2.set('key', 'value');

    const stats = factory.getGlobalStats();

    assert.ok(stats.namespaces.ns1);
    assert.ok(stats.namespaces.ns2);
  });

  it('should clear all caches', () => {
    const cache1 = factory.getCache('clear1');
    const cache2 = factory.getCache('clear2');

    cache1.set('key', 'value');
    cache2.set('key', 'value');

    factory.clearAll();

    assert.strictEqual(cache1.get('key'), null);
    assert.strictEqual(cache2.get('key'), null);
  });
});
