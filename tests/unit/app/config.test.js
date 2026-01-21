import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppConfig,
  parseBoolSafe,
  parseFloatSafe,
  parseIntSafe,
  parseJsonSafe,
  parseListSafe
} from '../../../src/app/config.js';

describe('app config', () => {
  describe('parser helpers', () => {
    it('parseBoolSafe handles common truthy/falsy values', () => {
      assert.equal(parseBoolSafe(undefined, true), true);
      assert.equal(parseBoolSafe(null, true), true);
      assert.equal(parseBoolSafe('true'), true);
      assert.equal(parseBoolSafe(' yes '), true);
      assert.equal(parseBoolSafe('1'), true);
      assert.equal(parseBoolSafe('false', true), false);
      assert.equal(parseBoolSafe('off', true), false);
      assert.equal(parseBoolSafe('0', true), false);
      assert.equal(parseBoolSafe('unknown', true), true);
      assert.equal(parseBoolSafe('unknown', false), false);
    });

    it('parseIntSafe and parseFloatSafe fall back safely', () => {
      assert.equal(parseIntSafe(undefined, 10), 10);
      assert.equal(parseIntSafe('', 10), 10);
      assert.equal(parseIntSafe('25', 10), 25);
      assert.equal(parseIntSafe('nope', 10), 10);

      assert.equal(parseFloatSafe(undefined, 1.5), 1.5);
      assert.equal(parseFloatSafe('', 1.5), 1.5);
      assert.equal(parseFloatSafe('2.25', 1.5), 2.25);
      assert.equal(parseFloatSafe('nope', 1.5), 1.5);
    });

    it('parseListSafe and parseJsonSafe behave consistently', () => {
      assert.deepEqual(parseListSafe(undefined), []);
      assert.deepEqual(parseListSafe('a, b,,c'), ['a', 'b', 'c']);
      assert.deepEqual(parseListSafe(['x', 'y']), ['x', 'y']);

      const obj = { a: 1 };
      assert.deepEqual(parseJsonSafe(undefined, { ok: true }), { ok: true });
      assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 });
      assert.deepEqual(parseJsonSafe(obj), obj);
      assert.deepEqual(parseJsonSafe('{ broken', { ok: true }), { ok: true });
    });
  });

  describe('buildAppConfig', () => {
    it('applies sane defaults for missing env', () => {
      const config = buildAppConfig({});

      assert.equal(config.server.nodeEnv, 'development');
      assert.equal(config.server.port, 4101);
      assert.equal(config.server.requestJsonLimit, '5mb');
      assert.equal(config.server.enablePortFallback, false);
      assert.equal(config.server.portFallbackAttempts, 10);

      assert.equal(config.apiAuth.enabled, false);
    });

    it('treats empty strings as missing for NODE_ENV and REQUEST_JSON_LIMIT', () => {
      const config = buildAppConfig({ NODE_ENV: '', REQUEST_JSON_LIMIT: '' });
      assert.equal(config.server.nodeEnv, 'development');
      assert.equal(config.server.requestJsonLimit, '5mb');
    });

    it('enables api auth with either env toggle', () => {
      assert.equal(buildAppConfig({ ENABLE_API_AUTH: 'true' }).apiAuth.enabled, true);
      assert.equal(buildAppConfig({ API_AUTH_ENABLED: 'true' }).apiAuth.enabled, true);
    });

    it('includes provider availability timeframes when provided', () => {
      const config = buildAppConfig({ PROVIDER_AVAILABILITY_TIMEFRAMES: 'M1,M5,H1' });
      assert.deepEqual(config.server.providerAvailabilityTimeframes, ['M1', 'M5', 'H1']);
    });

    it('builds alert email config only when required fields exist', () => {
      const disabled = buildAppConfig({});
      assert.equal(disabled.alerting.email, null);

      const enabled = buildAppConfig({
        ALERT_EMAIL_FROM: 'from@example.com',
        ALERT_EMAIL_TO: 'to@example.com',
        ALERT_SMTP_HOST: 'smtp.example.com',
        ALERT_SMTP_PORT: '2525',
        ALERT_SMTP_SECURE: 'true',
        ALERT_SMTP_USER: 'user',
        ALERT_SMTP_PASSWORD: 'pass'
      });

      assert.ok(enabled.alerting.email);
      assert.equal(enabled.alerting.email.from, 'from@example.com');
      assert.equal(enabled.alerting.email.to, 'to@example.com');
      assert.equal(enabled.alerting.email.smtp.host, 'smtp.example.com');
      assert.equal(enabled.alerting.email.smtp.port, 2525);
      assert.equal(enabled.alerting.email.smtp.secure, true);
    });

    it('only enables OANDA broker when toggle + required credentials exist', () => {
      const missingCreds = buildAppConfig({ ENABLE_BROKER_OANDA: 'true' });
      assert.equal(missingCreds.brokers.oanda.enabled, false);

      const enabled = buildAppConfig({
        ENABLE_BROKER_OANDA: 'true',
        OANDA_ACCESS_TOKEN: 'token',
        OANDA_ACCOUNT_ID: 'account'
      });
      assert.equal(enabled.brokers.oanda.enabled, true);
    });
  });
});
