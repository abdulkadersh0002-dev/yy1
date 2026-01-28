/**
 * Application Constants
 * 
 * Centralized constants to eliminate magic numbers and strings
 * throughout the codebase.
 */

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// ============================================================================
// Time Constants (milliseconds)
// ============================================================================

export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  
  // Common durations
  FIVE_SECONDS: 5 * 1000,
  TEN_SECONDS: 10 * 1000,
  THIRTY_SECONDS: 30 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  THIRTY_MINUTES: 30 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  TWO_HOURS: 2 * 60 * 60 * 1000,
  FOUR_HOURS: 4 * 60 * 60 * 1000,
  TWELVE_HOURS: 12 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000
};

// ============================================================================
// Trading Constants
// ============================================================================

export const TRADING = {
  // Position types
  POSITION_TYPE: {
    BUY: 'BUY',
    SELL: 'SELL',
    LONG: 'LONG',
    SHORT: 'SHORT'
  },
  
  // Order types
  ORDER_TYPE: {
    MARKET: 'MARKET',
    LIMIT: 'LIMIT',
    STOP: 'STOP',
    STOP_LIMIT: 'STOP_LIMIT'
  },
  
  // Order status
  ORDER_STATUS: {
    PENDING: 'PENDING',
    FILLED: 'FILLED',
    PARTIALLY_FILLED: 'PARTIALLY_FILLED',
    CANCELLED: 'CANCELLED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED'
  },
  
  // Trade status
  TRADE_STATUS: {
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    PENDING: 'PENDING',
    CANCELLED: 'CANCELLED'
  },
  
  // Signal directions
  SIGNAL_DIRECTION: {
    BUY: 'BUY',
    SELL: 'SELL',
    NEUTRAL: 'NEUTRAL',
    HOLD: 'HOLD'
  },
  
  // Default limits
  MIN_CONFIDENCE: 0,
  MAX_CONFIDENCE: 100,
  MIN_STRENGTH: 0,
  MAX_STRENGTH: 100,
  MIN_RISK_REWARD: 1.0,
  MAX_RISK_REWARD: 10.0,
  MIN_POSITION_SIZE: 0.01,
  MAX_POSITION_SIZE: 100.0,
  DEFAULT_LEVERAGE: 1,
  MAX_LEVERAGE: 500
};

// ============================================================================
// Database Constants
// ============================================================================

export const DATABASE = {
  // Query timeouts
  DEFAULT_QUERY_TIMEOUT: 30000, // 30 seconds
  SLOW_QUERY_THRESHOLD: 100, // 100ms
  VERY_SLOW_QUERY_THRESHOLD: 1000, // 1 second
  
  // Connection pool
  MIN_POOL_SIZE: 2,
  DEFAULT_POOL_SIZE: 10,
  MAX_POOL_SIZE: 50,
  POOL_IDLE_TIMEOUT: 30000,
  CONNECTION_TIMEOUT: 10000,
  
  // Cache TTL
  DEFAULT_CACHE_TTL: 60000, // 1 minute
  SHORT_CACHE_TTL: 30000, // 30 seconds
  LONG_CACHE_TTL: 300000 // 5 minutes
};

// ============================================================================
// Performance Thresholds
// ============================================================================

export const PERFORMANCE = {
  // Response time categories (milliseconds)
  FAST_RESPONSE: 100,
  NORMAL_RESPONSE: 500,
  SLOW_RESPONSE: 1000,
  VERY_SLOW_RESPONSE: 5000,
  
  // Request limits
  DEFAULT_RATE_LIMIT: 100, // requests per minute
  BURST_RATE_LIMIT: 200,
  
  // Memory limits (bytes)
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  
  // Request size limits
  DEFAULT_JSON_LIMIT: '10mb',
  MAX_JSON_LIMIT: '50mb'
};

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  // Validation errors
  INVALID_REQUEST_BODY: 'Invalid request body',
  INVALID_REQUEST_QUERY: 'Invalid request query',
  INVALID_PARAMETER: 'Invalid parameter',
  MISSING_REQUIRED_FIELD: 'Missing required field',
  
  // Authentication errors
  UNAUTHORIZED: 'Unauthorized',
  INVALID_TOKEN: 'Invalid token',
  TOKEN_EXPIRED: 'Token expired',
  INSUFFICIENT_PERMISSIONS: 'Insufficient permissions',
  
  // Resource errors
  NOT_FOUND: 'Resource not found',
  ALREADY_EXISTS: 'Resource already exists',
  CONFLICT: 'Resource conflict',
  
  // Database errors
  DATABASE_ERROR: 'Database error',
  QUERY_FAILED: 'Query failed',
  CONNECTION_FAILED: 'Connection failed',
  TRANSACTION_FAILED: 'Transaction failed',
  
  // Service errors
  SERVICE_UNAVAILABLE: 'Service unavailable',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  EXTERNAL_SERVICE_ERROR: 'External service error',
  TIMEOUT: 'Request timeout',
  
  // Configuration errors
  INVALID_CONFIGURATION: 'Invalid configuration',
  MISSING_CONFIGURATION: 'Missing configuration',
  
  // Trading errors
  INVALID_SYMBOL: 'Invalid trading symbol',
  INVALID_POSITION_SIZE: 'Invalid position size',
  INSUFFICIENT_BALANCE: 'Insufficient balance',
  MARKET_CLOSED: 'Market is closed',
  ORDER_REJECTED: 'Order rejected',
  BROKER_ERROR: 'Broker error'
};

// ============================================================================
// Success Messages
// ============================================================================

export const SUCCESS_MESSAGES = {
  CREATED: 'Resource created successfully',
  UPDATED: 'Resource updated successfully',
  DELETED: 'Resource deleted successfully',
  OPERATION_COMPLETED: 'Operation completed successfully',
  TRADE_EXECUTED: 'Trade executed successfully',
  ORDER_PLACED: 'Order placed successfully',
  ORDER_CANCELLED: 'Order cancelled successfully'
};

// ============================================================================
// Environment Types
// ============================================================================

export const ENVIRONMENT = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  STAGING: 'staging',
  PRODUCTION: 'production'
};

// ============================================================================
// Broker Types
// ============================================================================

export const BROKERS = {
  MT4: 'MT4',
  MT5: 'MT5',
  OANDA: 'OANDA',
  IBKR: 'IBKR',
  FOREX_COM: 'FOREX_COM'
};

// ============================================================================
// Log Levels
// ============================================================================

export const LOG_LEVELS = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
};

// ============================================================================
// Market States
// ============================================================================

export const MARKET_STATE = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  PRE_MARKET: 'PRE_MARKET',
  POST_MARKET: 'POST_MARKET',
  HOLIDAY: 'HOLIDAY'
};

// ============================================================================
// Timeframes
// ============================================================================

export const TIMEFRAME = {
  M1: 'M1',    // 1 minute
  M5: 'M5',    // 5 minutes
  M15: 'M15',  // 15 minutes
  M30: 'M30',  // 30 minutes
  H1: 'H1',    // 1 hour
  H4: 'H4',    // 4 hours
  D1: 'D1',    // 1 day
  W1: 'W1',    // 1 week
  MN: 'MN'     // 1 month
};

// ============================================================================
// API Endpoints
// ============================================================================

export const API_ENDPOINTS = {
  // Health
  HEALTH: '/api/healthz',
  READY: '/api/ready',
  
  // Metrics
  METRICS_PERFORMANCE: '/api/metrics/performance',
  METRICS_ERRORS: '/api/metrics/errors',
  METRICS_SYSTEM: '/api/metrics/system',
  METRICS_OVERVIEW: '/api/metrics/overview',
  
  // Database
  DATABASE_HEALTH: '/api/database/health',
  DATABASE_POOL: '/api/database/pool',
  DATABASE_QUERIES: '/api/database/queries',
  DATABASE_PERFORMANCE: '/api/database/performance',
  
  // Trading
  TRADES: '/api/trades',
  SIGNALS: '/api/signals',
  ORDERS: '/api/orders',
  POSITIONS: '/api/positions'
};

// ============================================================================
// Configuration Keys
// ============================================================================

export const CONFIG_KEYS = {
  // Server
  PORT: 'PORT',
  NODE_ENV: 'NODE_ENV',
  
  // Database
  DATABASE_URL: 'DATABASE_URL',
  DB_POOL_MAX: 'DB_POOL_MAX',
  DB_POOL_MIN: 'DB_POOL_MIN',
  
  // Trading
  AUTO_TRADING_ENABLED: 'AUTO_TRADING_ENABLED',
  AUTO_TRADING_MIN_CONFIDENCE: 'AUTO_TRADING_MIN_CONFIDENCE',
  AUTO_TRADING_MIN_STRENGTH: 'AUTO_TRADING_MIN_STRENGTH',
  
  // Brokers
  MT4_ENABLED: 'MT4_ENABLED',
  MT5_ENABLED: 'MT5_ENABLED',
  OANDA_API_KEY: 'OANDA_API_KEY',
  
  // Security
  JWT_SECRET: 'JWT_SECRET',
  CORS_ORIGIN: 'CORS_ORIGIN',
  
  // Features
  ENABLE_DEBUG_ROUTES: 'ENABLE_DEBUG_ROUTES',
  ENABLE_WEBSOCKETS: 'ENABLE_WEBSOCKETS'
};

// ============================================================================
// Default Export
// ============================================================================

export default {
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
};
