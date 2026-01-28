/**
 * Centralized Error Handler Middleware
 *
 * Provides consistent error handling and categorization
 * Part of Phase 1A Quick Wins - Error handling improvements
 */

import logger from '../services/logging/logger.js';

// Error categories
export const ErrorCategory = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  BUSINESS_LOGIC: 'BUSINESS_LOGIC_ERROR',
  EXTERNAL_SERVICE: 'EXTERNAL_SERVICE_ERROR',
  DATABASE: 'DATABASE_ERROR',
  INTERNAL: 'INTERNAL_ERROR',
};

// Error statistics
const errorStats = {
  total: 0,
  byCategory: new Map(),
  byStatusCode: new Map(),
  lastErrors: [],
};

/**
 * Custom Application Error
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, category = ErrorCategory.INTERNAL, details = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.category = category;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Track error statistics
 */
function trackError(error, statusCode) {
  errorStats.total++;

  // Track by category
  const category = error.category || ErrorCategory.INTERNAL;
  errorStats.byCategory.set(category, (errorStats.byCategory.get(category) || 0) + 1);

  // Track by status code
  errorStats.byStatusCode.set(statusCode, (errorStats.byStatusCode.get(statusCode) || 0) + 1);

  // Keep last 10 errors
  errorStats.lastErrors.push({
    timestamp: new Date().toISOString(),
    message: error.message,
    category,
    statusCode,
  });

  if (errorStats.lastErrors.length > 10) {
    errorStats.lastErrors.shift();
  }
}

/**
 * Get error statistics
 */
export function getErrorStats() {
  return {
    total: errorStats.total,
    byCategory: Object.fromEntries(errorStats.byCategory),
    byStatusCode: Object.fromEntries(errorStats.byStatusCode),
    lastErrors: errorStats.lastErrors,
  };
}

/**
 * Determine error status code
 */
function getStatusCode(error) {
  if (error.statusCode) {
    return error.statusCode;
  }
  if (error.name === 'ValidationError') {
    return 400;
  }
  if (error.name === 'UnauthorizedError') {
    return 401;
  }
  if (error.name === 'ForbiddenError') {
    return 403;
  }
  if (error.name === 'NotFoundError') {
    return 404;
  }
  return 500;
}

/**
 * Determine error category
 */
function getErrorCategory(error) {
  if (error.category) {
    return error.category;
  }

  const statusCode = getStatusCode(error);
  if (statusCode === 400) {
    return ErrorCategory.VALIDATION;
  }
  if (statusCode === 401) {
    return ErrorCategory.AUTHENTICATION;
  }
  if (statusCode === 403) {
    return ErrorCategory.AUTHORIZATION;
  }
  if (statusCode === 404) {
    return ErrorCategory.NOT_FOUND;
  }
  if (statusCode >= 500) {
    return ErrorCategory.INTERNAL;
  }

  return ErrorCategory.BUSINESS_LOGIC;
}

/**
 * Format error response
 */
function formatErrorResponse(error, isDevelopment = false) {
  const statusCode = getStatusCode(error);
  const category = getErrorCategory(error);

  const response = {
    error: {
      message: error.message || 'An error occurred',
      category,
      statusCode,
    },
  };

  // Add details in development mode
  if (isDevelopment) {
    response.error.stack = error.stack;
    response.error.details = error.details;
  }

  // Add validation errors if present
  if (error.errors) {
    response.error.validationErrors = error.errors;
  }

  return response;
}

/**
 * Centralized error handler middleware
 */
export default function errorHandler(error, req, res, next) {
  const statusCode = getStatusCode(error);
  const category = getErrorCategory(error);
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Track error
  trackError(error, statusCode);

  // Log error
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('Error occurred', {
    correlationId: req.correlationId,
    message: error.message,
    category,
    statusCode,
    method: req.method,
    path: req.path,
    stack: isDevelopment ? error.stack : undefined,
  });

  // Send error response
  res.status(statusCode).json(formatErrorResponse(error, isDevelopment));
}

/**
 * Not found handler (404)
 */
export function notFoundHandler(req, res) {
  const error = new AppError(
    `Route not found: ${req.method} ${req.path}`,
    404,
    ErrorCategory.NOT_FOUND
  );

  logger.warn('Route not found', {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
  });

  trackError(error, 404);

  res.status(404).json({
    error: {
      message: error.message,
      category: ErrorCategory.NOT_FOUND,
      statusCode: 404,
    },
  });
}
