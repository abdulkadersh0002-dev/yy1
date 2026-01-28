import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigValidator } from '../../../src/infrastructure/config/config-validator.js';

describe('ConfigValidator', () => {
  it('should validate basic server configuration', () => {
    const env = {
      NODE_ENV: 'development',
      PORT: '4101',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should detect invalid port number', () => {
    const env = {
      PORT: '99999', // Exceeds max
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes('PORT')));
  });

  it('should detect invalid NODE_ENV', () => {
    const env = {
      NODE_ENV: 'invalid_env',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, true); // Just a warning
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.includes('NODE_ENV')));
  });

  it('should validate trading configuration', () => {
    const env = {
      EA_ONLY_MODE: 'true',
      AUTO_TRADING_MIN_CONFIDENCE: '75',
      AUTO_TRADING_MIN_STRENGTH: '60',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, true);
  });

  it('should detect out-of-range trading parameters', () => {
    const env = {
      EA_ONLY_MODE: 'true',
      AUTO_TRADING_MIN_CONFIDENCE: '150', // > 100
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes('AUTO_TRADING_MIN_CONFIDENCE')));
  });

  it('should validate broker configuration', () => {
    const env = {
      EA_ONLY_MODE: 'true',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    // Should pass with EA_ONLY_MODE
    assert.equal(result.isValid, true);
  });

  it('should detect missing OANDA account ID', () => {
    const env = {
      OANDA_API_KEY: 'test_key',
      // Missing OANDA_ACCOUNT_ID
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes('OANDA_ACCOUNT_ID')));
  });

  it('should validate security configuration', () => {
    const env = {
      NODE_ENV: 'development',
      JWT_SECRET: 'this_is_a_long_enough_secret_for_testing_purposes_only',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, true);
  });

  it('should detect short JWT_SECRET in production', () => {
    const env = {
      NODE_ENV: 'production',
      JWT_SECRET: 'short', // Too short
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes('JWT_SECRET')));
  });

  it('should get configuration summary', () => {
    const env = {
      NODE_ENV: 'development',
      PORT: '4101',
      EA_ONLY_MODE: 'true',
      ENABLE_WEBSOCKETS: 'true',
    };

    const summary = ConfigValidator.getSummary(env);

    assert.equal(summary.server.nodeEnv, 'development');
    assert.equal(summary.server.port, '4101');
    assert.equal(summary.trading.eaOnlyMode, true);
    assert.equal(summary.server.enableWebsockets, true);
  });

  it('should validate REQUEST_JSON_LIMIT format', () => {
    const env = {
      REQUEST_JSON_LIMIT: 'invalid_format',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes('REQUEST_JSON_LIMIT')));
  });

  it('should accept valid REQUEST_JSON_LIMIT', () => {
    const env = {
      REQUEST_JSON_LIMIT: '10mb',
    };

    const validator = new ConfigValidator();
    const result = validator.validate(env);

    assert.equal(result.isValid, true);
  });
});
