/**
 * Tests for Error Handler Middleware
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AppError,
  ErrorCategory,
  getErrorStats,
} from '../../../src/infrastructure/middleware/error-handler.js';

describe('Error Handler Middleware', () => {
  it('should create AppError with correct properties', () => {
    const error = new AppError('Test error', 400, ErrorCategory.VALIDATION, { field: 'email' });

    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.category, ErrorCategory.VALIDATION);
    assert.deepStrictEqual(error.details, { field: 'email' });
    assert.ok(error.isOperational);
  });

  it('should have all error categories defined', () => {
    assert.ok(ErrorCategory.VALIDATION);
    assert.ok(ErrorCategory.AUTHENTICATION);
    assert.ok(ErrorCategory.AUTHORIZATION);
    assert.ok(ErrorCategory.NOT_FOUND);
    assert.ok(ErrorCategory.BUSINESS_LOGIC);
    assert.ok(ErrorCategory.EXTERNAL_SERVICE);
    assert.ok(ErrorCategory.DATABASE);
    assert.ok(ErrorCategory.INTERNAL);
  });

  it('should get error statistics', () => {
    const stats = getErrorStats();
    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.byCategory === 'object');
    assert.ok(typeof stats.byStatusCode === 'object');
    assert.ok(Array.isArray(stats.lastErrors));
  });

  it('should capture stack trace', () => {
    const error = new AppError('Test error');
    assert.ok(error.stack);
    assert.ok(error.stack.includes('AppError'));
  });
});
