import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { appConfig } from '../../app/config.js';

const env = appConfig?.env || process.env;

const level = env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug');
const serviceName = env.LOG_SERVICE_NAME || 'signals-strategy';
const environment = env.NODE_ENV || 'development';
const version = env.APP_VERSION || undefined;
const logDir = env.LOG_DIR || 'logs';

const base = {
  service: serviceName,
  environment,
  version
};

const targets = [];

const resolveTargetPath = (targetPath) => {
  if (!targetPath.startsWith('./')) {
    return targetPath;
  }

  return new URL(targetPath, import.meta.url).pathname;
};

const enableConsole = env.LOG_TO_STDOUT !== 'false';
const enableFile = env.LOG_FILE_ENABLED !== 'false';

if (enableConsole) {
  if (environment === 'production') {
    targets.push({
      target: 'pino/file',
      level,
      options: { destination: 1 } // stdout as JSON
    });
  } else {
    targets.push({
      target: 'pino-pretty',
      level,
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    });
  }
}

if (enableFile) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    targets.push({
      target: 'pino/file',
      level,
      options: {
        destination: path.join(logDir, 'application.log'),
        mkdir: true
      }
    });
  } catch (error) {
    console.error('Failed to initialize log directory:', error.message);
  }
}

if (env.LOKI_ENDPOINT) {
  targets.push({
    target: resolveTargetPath('./loki-transport.cjs'),
    options: {
      endpoint: env.LOKI_ENDPOINT,
      tenantId: env.LOKI_TENANT_ID || null,
      basicAuth: env.LOKI_BASIC_AUTH || null,
      batchSize: Number(env.LOKI_BATCH_SIZE || '20'),
      flushIntervalMs: Number(env.LOKI_FLUSH_INTERVAL || '5000'),
      labels: {
        service: serviceName,
        environment,
        app: 'signals-strategy'
      }
    },
    level: env.LOKI_LOG_LEVEL || level
  });
}

if (env.ELASTIC_ENDPOINT) {
  let parsedHeaders;
  if (env.ELASTIC_HEADERS) {
    try {
      parsedHeaders = JSON.parse(env.ELASTIC_HEADERS);
    } catch (error) {
      console.error('Failed to parse ELASTIC_HEADERS env var:', error.message);
    }
  }

  targets.push({
    target: resolveTargetPath('./opensearch-transport.cjs'),
    options: {
      endpoint: env.ELASTIC_ENDPOINT,
      indexPrefix: env.ELASTIC_INDEX_PREFIX || 'signals-strategy',
      apiKey: env.ELASTIC_API_KEY || null,
      username: env.ELASTIC_USERNAME || null,
      password: env.ELASTIC_PASSWORD || null,
      headers: parsedHeaders,
      batchSize: Number(env.ELASTIC_BATCH_SIZE || '50'),
      flushInterval: Number(env.ELASTIC_FLUSH_INTERVAL || '5000')
    },
    level: env.ELASTIC_LOG_LEVEL || level
  });
}

const transport =
  targets.length > 0
    ? pino.transport({
        targets: targets.map((target) => ({
          ...target,
          target: typeof target.target === 'string' ? target.target : target.target
        }))
      })
    : undefined;

const logger = transport
  ? pino(
      {
        level,
        base,
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(value) {
            return { level: value };
          }
        }
      },
      transport
    )
  : pino({
      level,
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(value) {
          return { level: value };
        }
      }
    });

export default logger;
