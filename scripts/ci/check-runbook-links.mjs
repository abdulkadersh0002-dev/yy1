#!/usr/bin/env node
import { resolve } from 'node:path';
import { validateRunbookLinks } from './lib/runbook-links.js';

function parseArgs(argv) {
  const args = {
    input: 'mock-alerts.json',
    timeoutMs: 10000
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input') {
      if (index + 1 >= argv.length) {
        throw new Error('Missing value for --input');
      }
      index += 1;
      args.input = argv[index];
      continue;
    }
    if (token.startsWith('--input=')) {
      args.input = token.split('=')[1];
      continue;
    }
    if (token === '--timeout-ms') {
      if (index + 1 >= argv.length) {
        throw new Error('Missing value for --timeout-ms');
      }
      index += 1;
      args.timeoutMs = Number(argv[index]);
      continue;
    }
    if (token.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number(token.split('=')[1]);
    }
  }

  if (!args.input) {
    throw new Error('Input path must be provided');
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('Timeout must be a positive number of milliseconds');
  }

  return {
    input: resolve(process.cwd(), args.input),
    timeoutMs: args.timeoutMs
  };
}

async function main() {
  const { input, timeoutMs } = parseArgs(process.argv);
  await validateRunbookLinks({ inputPath: input, timeoutMs });
}

try {
  await main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
