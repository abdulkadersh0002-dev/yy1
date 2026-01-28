/**
 * Enhanced Request Logger Middleware
 *
 * Provides detailed request/response logging with correlation IDs
 * Part of Phase 1A Quick Wins - Logging improvements
 */

import { randomUUID } from 'crypto';
import logger from '../services/logging/logger.js';

/**
 * Generate correlation ID for request tracing
 * @returns {string} UUID v4
 */
function generateCorrelationId() {
  return randomUUID();
}

/**
 * Sanitize request data for logging (remove sensitive info)
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
function sanitize(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'authorization'];
  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Enhanced request logger middleware
 * Adds correlation IDs and detailed logging
 */
export default function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Generate or use existing correlation ID
  const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();

  // Add correlation ID to request and response
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // Log incoming request
  logger.info('Incoming request', {
    correlationId,
    method: req.method,
    path: req.path,
    query: sanitize(req.query),
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Capture original end method
  const originalEnd = res.end;

  // Override end method to log response
  res.end = function (...args) {
    const duration = Date.now() - startTime;

    // Log response
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]('Request completed', {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });

    // Call original end
    originalEnd.apply(res, args);
  };

  next();
}

export { generateCorrelationId, sanitize };
