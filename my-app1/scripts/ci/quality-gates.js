#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import dotenv from 'dotenv';
import { buildAppConfig } from '../../src/app/config.js';

function fail(message) {
  console.error(`Config quality gate failed: ${message}`);
  process.exit(1);
}

function loadExampleEnvironment() {
  const projectRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
  const envExamplePath = path.join(projectRoot, '.env.example');

  if (!fs.existsSync(envExamplePath)) {
    fail(`Missing .env.example at ${envExamplePath}`);
  }

  const fileContents = fs.readFileSync(envExamplePath, 'utf8');
  return dotenv.parse(fileContents);
}

function main() {
  const exampleEnv = loadExampleEnvironment();

  const overrides = {
    NODE_ENV: 'test',
    PORT: '4101',
    ENABLE_WEBSOCKETS: 'false',
    ENABLE_RISK_REPORTS: 'false',
    ENABLE_PERFORMANCE_DIGESTS: 'false',
    ENABLE_BROKER_ROUTING: 'false',
    ENABLE_BROKER_OANDA: 'false',
    ENABLE_BROKER_MT5: 'false',
    ENABLE_BROKER_IBKR: 'false',
    ENABLE_PREFETCH_SCHEDULER: 'false',
    AUTO_TRADING_AUTOSTART: 'false',
    DB_HOST: exampleEnv.DB_HOST || 'localhost',
    DB_USER: exampleEnv.DB_USER || 'ci-user',
    DB_PASSWORD: exampleEnv.DB_PASSWORD || 'ci-password',
    DB_NAME: exampleEnv.DB_NAME || 'ci-database'
  };

  let config;
  try {
    config = buildAppConfig({ ...exampleEnv, ...overrides });
  } catch (error) {
    fail(`Config builder threw: ${error.message}`);
  }

  const checks = [
    { ok: Number.isFinite(config.server.port), message: 'server.port is not numeric' },
    {
      ok: typeof config.server.enableWebSockets === 'boolean',
      message: 'server.enableWebSockets is not boolean'
    },
    {
      ok: config.database.host === overrides.DB_HOST,
      message: 'database.host override did not apply'
    },
    {
      ok: config.database.user === overrides.DB_USER,
      message: 'database.user override did not apply'
    },
    {
      ok: config.database.password === overrides.DB_PASSWORD,
      message: 'database.password override did not apply'
    },
    {
      ok: typeof config.services.riskReports.enabled === 'boolean',
      message: 'riskReports.enabled is not boolean'
    },
    {
      ok: typeof config.services.performanceDigests.enabled === 'boolean',
      message: 'performanceDigests.enabled is not boolean'
    },
    {
      ok: typeof config.services.autoTrading.autostart === 'boolean',
      message: 'autoTrading.autostart is not boolean'
    },
    {
      ok: Array.isArray(config.priceData.fastTimeframes || []),
      message: 'priceData.fastTimeframes not array'
    },
    {
      ok: Array.isArray(config.priceData.slowTimeframes || []),
      message: 'priceData.slowTimeframes not array'
    }
  ];

  const serviceChecks = Object.entries(config.services)
    .filter(
      ([, value]) =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'enabled')
    )
    .map(([name, value]) => ({
      ok: typeof value.enabled === 'boolean',
      message: `${name}.enabled is not boolean`
    }));

  checks.push(...serviceChecks);

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    fail(failed.map((check) => check.message).join('; '));
  }

  console.log('Config quality gates passed');
}

main();
