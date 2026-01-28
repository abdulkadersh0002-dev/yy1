/**
 * Middleware exports
 * Central export point for all middleware
 */

export {
  default as performanceMonitor,
  getPerformanceStats,
  resetPerformanceStats,
  THRESHOLDS,
} from './performance-monitor.js';
export { default as requestLogger, generateCorrelationId, sanitize } from './request-logger.js';
export {
  default as errorHandler,
  notFoundHandler,
  AppError,
  ErrorCategory,
  getErrorStats,
} from './error-handler.js';
