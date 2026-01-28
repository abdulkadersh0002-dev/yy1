import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ok,
  badRequest,
  notFound,
  serviceUnavailable,
  serverError
} from '../../src/utils/http-response.js';

describe('HTTP Response Utilities', () => {
  // Mock response object
  const createMockRes = () => {
    let statusCode = 200;
    let jsonData = null;

    return {
      locals: { requestId: 'test-request-id-123' },
      status: function (code) {
        statusCode = code;
        return this;
      },
      json: function (data) {
        jsonData = data;
        return { statusCode, jsonData };
      },
      getStatus: () => statusCode,
      getJson: () => jsonData
    };
  };

  describe('ok()', () => {
    it('should return success response with 200 status', () => {
      const res = createMockRes();
      const result = ok(res, { message: 'Success' });

      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(result.jsonData.success, true);
      assert.strictEqual(result.jsonData.message, 'Success');
      assert.strictEqual(result.jsonData.requestId, 'test-request-id-123');
      assert.ok(result.jsonData.timestamp);
    });

    it('should accept custom status code', () => {
      const res = createMockRes();
      const result = ok(res, { message: 'Created' }, { statusCode: 201 });

      assert.strictEqual(result.statusCode, 201);
      assert.strictEqual(result.jsonData.success, true);
    });

    it('should include custom timestamp', () => {
      const res = createMockRes();
      const customTimestamp = 1234567890;
      const result = ok(res, {}, { timestamp: customTimestamp });

      assert.strictEqual(result.jsonData.timestamp, customTimestamp);
    });
  });

  describe('badRequest()', () => {
    it('should return error response with 400 status', () => {
      const res = createMockRes();
      const result = badRequest(res, 'Invalid input');

      assert.strictEqual(result.statusCode, 400);
      assert.strictEqual(result.jsonData.success, false);
      assert.strictEqual(result.jsonData.error, 'Invalid input');
      assert.strictEqual(result.jsonData.requestId, 'test-request-id-123');
    });

    it('should handle error object', () => {
      const res = createMockRes();
      const error = new Error('Validation failed');
      const result = badRequest(res, error);

      assert.strictEqual(result.jsonData.error, 'Validation failed');
    });

    it('should include details if provided', () => {
      const res = createMockRes();
      const details = [{ path: 'email', message: 'Invalid format' }];
      const result = badRequest(res, 'Validation error', { details });

      assert.strictEqual(result.jsonData.details, details);
    });
  });

  describe('notFound()', () => {
    it('should return 404 status', () => {
      const res = createMockRes();
      const result = notFound(res);

      assert.strictEqual(result.statusCode, 404);
      assert.strictEqual(result.jsonData.success, false);
      assert.strictEqual(result.jsonData.error, 'Not found');
    });

    it('should accept custom error message', () => {
      const res = createMockRes();
      const result = notFound(res, 'Resource not found');

      assert.strictEqual(result.jsonData.error, 'Resource not found');
    });
  });

  describe('serviceUnavailable()', () => {
    it('should return 503 status', () => {
      const res = createMockRes();
      const result = serviceUnavailable(res);

      assert.strictEqual(result.statusCode, 503);
      assert.strictEqual(result.jsonData.success, false);
      assert.strictEqual(result.jsonData.error, 'Service unavailable');
    });

    it('should handle error object', () => {
      const res = createMockRes();
      const error = new Error('Database connection failed');
      const result = serviceUnavailable(res, error);

      assert.strictEqual(result.jsonData.error, 'Database connection failed');
    });
  });

  describe('serverError()', () => {
    it('should return 500 status', () => {
      const res = createMockRes();
      const result = serverError(res, 'Something went wrong');

      assert.strictEqual(result.statusCode, 500);
      assert.strictEqual(result.jsonData.success, false);
      assert.strictEqual(result.jsonData.error, 'Internal server error');
    });

    it('should include message in non-production', () => {
      const res = createMockRes();
      const result = serverError(res, 'Database error', { nodeEnv: 'development' });

      assert.strictEqual(result.jsonData.message, 'Database error');
    });

    it('should hide message in production', () => {
      const res = createMockRes();
      const result = serverError(res, 'Database error', { nodeEnv: 'production' });

      assert.strictEqual(result.jsonData.message, undefined);
      assert.strictEqual(result.jsonData.error, 'Internal server error');
    });

    it('should handle error object', () => {
      const res = createMockRes();
      const error = new Error('Critical failure');
      const result = serverError(res, error, { nodeEnv: 'development' });

      assert.strictEqual(result.jsonData.message, 'Critical failure');
    });
  });

  describe('requestId handling', () => {
    it('should work without requestId', () => {
      const res = createMockRes();
      delete res.locals.requestId;
      const result = ok(res, { message: 'Success' });

      assert.strictEqual(result.jsonData.requestId, undefined);
      assert.strictEqual(result.jsonData.success, true);
    });
  });
});
