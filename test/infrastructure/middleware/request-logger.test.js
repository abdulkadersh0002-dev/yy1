/**
 * Tests for Request Logger Middleware
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateCorrelationId,
  sanitize,
} from '../../../src/infrastructure/middleware/request-logger.js';

describe('Request Logger Middleware', () => {
  it('should generate correlation ID', () => {
    const id = generateCorrelationId();
    assert.ok(typeof id === 'string');
    assert.ok(id.length > 0);

    // UUID v4 format check (basic)
    assert.ok(id.includes('-'));
  });

  it('should generate unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    assert.notStrictEqual(id1, id2);
  });

  it('should sanitize sensitive data', () => {
    const data = {
      username: 'test',
      password: 'secret123',
      token: 'abc123',
      apiKey: 'key123',
      email: 'test@example.com',
    };

    const sanitized = sanitize(data);

    assert.strictEqual(sanitized.username, 'test');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
    assert.strictEqual(sanitized.apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.email, 'test@example.com');
  });

  it('should handle null/undefined data', () => {
    assert.strictEqual(sanitize(null), null);
    assert.strictEqual(sanitize(undefined), undefined);
    assert.strictEqual(sanitize('string'), 'string');
    assert.strictEqual(sanitize(123), 123);
  });

  it('should not modify original object', () => {
    const data = {
      username: 'test',
      password: 'secret123',
    };

    const sanitized = sanitize(data);

    assert.notStrictEqual(sanitized, data);
    assert.strictEqual(data.password, 'secret123'); // Original unchanged
    assert.strictEqual(sanitized.password, '[REDACTED]'); // Sanitized version
  });
});
