#!/usr/bin/env node
import { resolve } from 'node:path';
import { compareAlertSnapshots } from './lib/alertmanager-snapshots.js';

function parseArgs(argv) {
  const args = {
    input: 'mock-alerts.json',
    fixtures: 'scripts/ci/fixtures/alertmanager'
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
    if (token === '--fixtures') {
      if (index + 1 >= argv.length) {
        throw new Error('Missing value for --fixtures');
      }
      index += 1;
      args.fixtures = argv[index];
      continue;
    }
    if (token.startsWith('--fixtures=')) {
      args.fixtures = token.split('=')[1];
    }
  }

  if (!args.input) {
    throw new Error('Input path must be provided');
  }
  if (!args.fixtures) {
    throw new Error('Fixtures directory must be provided');
  }

  return {
    input: resolve(process.cwd(), args.input),
    fixtures: resolve(process.cwd(), args.fixtures)
  };
}

function main() {
  const { input, fixtures } = parseArgs(process.argv);
  compareAlertSnapshots({ inputPath: input, fixturesDir: fixtures });
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
