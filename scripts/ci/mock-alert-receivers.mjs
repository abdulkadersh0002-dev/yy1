#!/usr/bin/env node
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { port: 18080, output: 'mock-alerts.json' };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--port') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --port');
      }
      i += 1;
      args.port = Number(argv[i]);
      continue;
    }
    if (token.startsWith('--port=')) {
      args.port = Number(token.split('=')[1]);
      continue;
    }
    if (token === '--output') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --output');
      }
      i += 1;
      args.output = argv[i];
      continue;
    }
    if (token.startsWith('--output=')) {
      args.output = token.split('=')[1];
    }
  }
  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error(`Invalid port provided: ${args.port}`);
  }
  if (!args.output) {
    throw new Error('Output path must be provided');
  }
  return args;
}

const { port, output } = parseArgs(process.argv);
const absoluteOutput = resolve(process.cwd(), output);
mkdirSync(dirname(absoluteOutput), { recursive: true });
const requests = [];

function persist() {
  writeFileSync(absoluteOutput, JSON.stringify(requests, null, 2), 'utf8');
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    const bodyRaw = Buffer.concat(chunks).toString('utf8');
    let bodyJson = null;
    if (bodyRaw) {
      try {
        bodyJson = JSON.parse(bodyRaw);
      } catch (error) {
        bodyJson = null;
      }
    }
    requests.push({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.url,
      headers: req.headers,
      bodyRaw,
      bodyJson
    });
    try {
      persist();
    } catch (error) {
      console.error('Failed to persist mock alert payload:', error.message);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mock alert receivers listening on port ${port}`);
  persist();
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
