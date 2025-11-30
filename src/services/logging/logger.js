import fs from 'fs';
import path from 'path';
import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const serviceName = process.env.LOG_SERVICE_NAME || 'signals-strategy';
const environment = process.env.NODE_ENV || 'development';
const version = process.env.APP_VERSION || undefined;
const logDir = process.env.LOG_DIR || 'logs';

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

const enableConsole = process.env.LOG_TO_STDOUT !== 'false';
const enableFile = process.env.LOG_FILE_ENABLED !== 'false';

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

if (process.env.LOKI_ENDPOINT) {
  targets.push({
    target: resolveTargetPath('./loki-transport.cjs'),
    options: {
      endpoint: process.env.LOKI_ENDPOINT,
      tenantId: process.env.LOKI_TENANT_ID || null,
      basicAuth: process.env.LOKI_BASIC_AUTH || null,
      batchSize: Number(process.env.LOKI_BATCH_SIZE || '20'),
      flushIntervalMs: Number(process.env.LOKI_FLUSH_INTERVAL || '5000'),
      labels: {
        service: serviceName,
        environment,
        app: 'signals-strategy'
      }
    },
    level: process.env.LOKI_LOG_LEVEL || level
  });
}

if (process.env.ELASTIC_ENDPOINT) {
  let parsedHeaders;
  if (process.env.ELASTIC_HEADERS) {
    try {
      parsedHeaders = JSON.parse(process.env.ELASTIC_HEADERS);
    } catch (error) {
      console.error('Failed to parse ELASTIC_HEADERS env var:', error.message);
    }
  }

  targets.push({
    target: resolveTargetPath('./opensearch-transport.cjs'),
    options: {
      endpoint: process.env.ELASTIC_ENDPOINT,
      indexPrefix: process.env.ELASTIC_INDEX_PREFIX || 'signals-strategy',
      apiKey: process.env.ELASTIC_API_KEY || null,
      username: process.env.ELASTIC_USERNAME || null,
      password: process.env.ELASTIC_PASSWORD || null,
      headers: parsedHeaders,
      batchSize: Number(process.env.ELASTIC_BATCH_SIZE || '50'),
      flushIntervalMs: Number(process.env.ELASTIC_FLUSH_INTERVAL || '5000')
    },
    level: process.env.ELASTIC_LOG_LEVEL || level
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
