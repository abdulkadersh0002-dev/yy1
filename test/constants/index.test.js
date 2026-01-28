import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  HTTP_STATUS,
  TIME,
  TRADING,
  DATABASE,
  PERFORMANCE,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  ENVIRONMENT,
  BROKERS,
  LOG_LEVELS,
  MARKET_STATE,
  TIMEFRAME,
  API_ENDPOINTS,
  CONFIG_KEYS
} from '../../src/constants/index.js';

describe('Constants', () => {
  describe('HTTP_STATUS', () => {
    it('should have correct status codes', () => {
      assert.strictEqual(HTTP_STATUS.OK, 200);
      assert.strictEqual(HTTP_STATUS.CREATED, 201);
      assert.strictEqual(HTTP_STATUS.BAD_REQUEST, 400);
      assert.strictEqual(HTTP_STATUS.UNAUTHORIZED, 401);
      assert.strictEqual(HTTP_STATUS.NOT_FOUND, 404);
      assert.strictEqual(HTTP_STATUS.INTERNAL_SERVER_ERROR, 500);
      assert.strictEqual(HTTP_STATUS.SERVICE_UNAVAILABLE, 503);
    });
  });

  describe('TIME', () => {
    it('should have correct time values in milliseconds', () => {
      assert.strictEqual(TIME.SECOND, 1000);
      assert.strictEqual(TIME.MINUTE, 60000);
      assert.strictEqual(TIME.HOUR, 3600000);
      assert.strictEqual(TIME.DAY, 86400000);
    });

    it('should have common duration constants', () => {
      assert.strictEqual(TIME.FIVE_SECONDS, 5000);
      assert.strictEqual(TIME.TEN_SECONDS, 10000);
      assert.strictEqual(TIME.FIVE_MINUTES, 300000);
      assert.strictEqual(TIME.ONE_HOUR, 3600000);
    });
  });

  describe('TRADING', () => {
    it('should have position types', () => {
      assert.strictEqual(TRADING.POSITION_TYPE.BUY, 'BUY');
      assert.strictEqual(TRADING.POSITION_TYPE.SELL, 'SELL');
    });

    it('should have order types', () => {
      assert.strictEqual(TRADING.ORDER_TYPE.MARKET, 'MARKET');
      assert.strictEqual(TRADING.ORDER_TYPE.LIMIT, 'LIMIT');
    });

    it('should have trade status values', () => {
      assert.strictEqual(TRADING.TRADE_STATUS.OPEN, 'OPEN');
      assert.strictEqual(TRADING.TRADE_STATUS.CLOSED, 'CLOSED');
    });

    it('should have correct limit values', () => {
      assert.strictEqual(TRADING.MIN_CONFIDENCE, 0);
      assert.strictEqual(TRADING.MAX_CONFIDENCE, 100);
      assert.strictEqual(TRADING.MIN_RISK_REWARD, 1.0);
      assert.strictEqual(TRADING.MAX_RISK_REWARD, 10.0);
    });
  });

  describe('DATABASE', () => {
    it('should have query thresholds', () => {
      assert.strictEqual(DATABASE.SLOW_QUERY_THRESHOLD, 100);
      assert.strictEqual(DATABASE.VERY_SLOW_QUERY_THRESHOLD, 1000);
    });

    it('should have pool configuration', () => {
      assert.strictEqual(DATABASE.MIN_POOL_SIZE, 2);
      assert.strictEqual(DATABASE.DEFAULT_POOL_SIZE, 10);
      assert.strictEqual(DATABASE.MAX_POOL_SIZE, 50);
    });

    it('should have cache TTL values', () => {
      assert.strictEqual(DATABASE.DEFAULT_CACHE_TTL, 60000);
      assert.strictEqual(DATABASE.SHORT_CACHE_TTL, 30000);
      assert.strictEqual(DATABASE.LONG_CACHE_TTL, 300000);
    });
  });

  describe('PERFORMANCE', () => {
    it('should have response time thresholds', () => {
      assert.strictEqual(PERFORMANCE.FAST_RESPONSE, 100);
      assert.strictEqual(PERFORMANCE.NORMAL_RESPONSE, 500);
      assert.strictEqual(PERFORMANCE.SLOW_RESPONSE, 1000);
    });

    it('should have memory limits', () => {
      assert.strictEqual(PERFORMANCE.MB, 1048576);
      assert.strictEqual(PERFORMANCE.GB, 1073741824);
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have validation error messages', () => {
      assert.strictEqual(ERROR_MESSAGES.INVALID_REQUEST_BODY, 'Invalid request body');
      assert.strictEqual(ERROR_MESSAGES.MISSING_REQUIRED_FIELD, 'Missing required field');
    });

    it('should have authentication error messages', () => {
      assert.strictEqual(ERROR_MESSAGES.UNAUTHORIZED, 'Unauthorized');
      assert.strictEqual(ERROR_MESSAGES.TOKEN_EXPIRED, 'Token expired');
    });

    it('should have trading error messages', () => {
      assert.strictEqual(ERROR_MESSAGES.INVALID_SYMBOL, 'Invalid trading symbol');
      assert.strictEqual(ERROR_MESSAGES.INSUFFICIENT_BALANCE, 'Insufficient balance');
    });
  });

  describe('SUCCESS_MESSAGES', () => {
    it('should have success messages', () => {
      assert.strictEqual(SUCCESS_MESSAGES.CREATED, 'Resource created successfully');
      assert.strictEqual(SUCCESS_MESSAGES.UPDATED, 'Resource updated successfully');
      assert.strictEqual(SUCCESS_MESSAGES.DELETED, 'Resource deleted successfully');
    });
  });

  describe('ENVIRONMENT', () => {
    it('should have environment types', () => {
      assert.strictEqual(ENVIRONMENT.DEVELOPMENT, 'development');
      assert.strictEqual(ENVIRONMENT.TEST, 'test');
      assert.strictEqual(ENVIRONMENT.PRODUCTION, 'production');
    });
  });

  describe('BROKERS', () => {
    it('should have broker types', () => {
      assert.strictEqual(BROKERS.MT4, 'MT4');
      assert.strictEqual(BROKERS.MT5, 'MT5');
      assert.strictEqual(BROKERS.OANDA, 'OANDA');
      assert.strictEqual(BROKERS.IBKR, 'IBKR');
    });
  });

  describe('LOG_LEVELS', () => {
    it('should have log levels', () => {
      assert.strictEqual(LOG_LEVELS.INFO, 'info');
      assert.strictEqual(LOG_LEVELS.WARN, 'warn');
      assert.strictEqual(LOG_LEVELS.ERROR, 'error');
    });
  });

  describe('MARKET_STATE', () => {
    it('should have market states', () => {
      assert.strictEqual(MARKET_STATE.OPEN, 'OPEN');
      assert.strictEqual(MARKET_STATE.CLOSED, 'CLOSED');
      assert.strictEqual(MARKET_STATE.HOLIDAY, 'HOLIDAY');
    });
  });

  describe('TIMEFRAME', () => {
    it('should have timeframe values', () => {
      assert.strictEqual(TIMEFRAME.M1, 'M1');
      assert.strictEqual(TIMEFRAME.M5, 'M5');
      assert.strictEqual(TIMEFRAME.M15, 'M15');
      assert.strictEqual(TIMEFRAME.H1, 'H1');
      assert.strictEqual(TIMEFRAME.H4, 'H4');
      assert.strictEqual(TIMEFRAME.D1, 'D1');
    });
  });

  describe('API_ENDPOINTS', () => {
    it('should have health endpoints', () => {
      assert.strictEqual(API_ENDPOINTS.HEALTH, '/api/healthz');
      assert.strictEqual(API_ENDPOINTS.READY, '/api/ready');
    });

    it('should have metrics endpoints', () => {
      assert.strictEqual(API_ENDPOINTS.METRICS_PERFORMANCE, '/api/metrics/performance');
      assert.strictEqual(API_ENDPOINTS.METRICS_ERRORS, '/api/metrics/errors');
    });

    it('should have database endpoints', () => {
      assert.strictEqual(API_ENDPOINTS.DATABASE_HEALTH, '/api/database/health');
      assert.strictEqual(API_ENDPOINTS.DATABASE_POOL, '/api/database/pool');
    });
  });

  describe('CONFIG_KEYS', () => {
    it('should have server configuration keys', () => {
      assert.strictEqual(CONFIG_KEYS.PORT, 'PORT');
      assert.strictEqual(CONFIG_KEYS.NODE_ENV, 'NODE_ENV');
    });

    it('should have database configuration keys', () => {
      assert.strictEqual(CONFIG_KEYS.DATABASE_URL, 'DATABASE_URL');
      assert.strictEqual(CONFIG_KEYS.DB_POOL_MAX, 'DB_POOL_MAX');
    });

    it('should have trading configuration keys', () => {
      assert.strictEqual(CONFIG_KEYS.AUTO_TRADING_ENABLED, 'AUTO_TRADING_ENABLED');
      assert.strictEqual(CONFIG_KEYS.AUTO_TRADING_MIN_CONFIDENCE, 'AUTO_TRADING_MIN_CONFIDENCE');
    });
  });
});
