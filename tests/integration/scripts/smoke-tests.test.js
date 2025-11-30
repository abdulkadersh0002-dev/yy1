import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

async function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DB_HOST: '',
        DB_NAME: '',
        DB_USER: '',
        DB_PASSWORD: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('Historical warehouse ETL smoke run', async () => {
  const configPath = path.join(
    repoRoot,
    'tests/fixtures/config/historical-warehouse.test.config.json'
  );
  const result = await runNodeScript('scripts/etl/run-historical-warehouse.js', [
    '--config',
    configPath,
    '--dry-run'
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Historical Warehouse ETL Summary/);
  assert.match(result.stdout, /Dry run\s+: yes/);
});

test('Backtest pipeline smoke run', async () => {
  const configPath = path.join(repoRoot, 'tests/fixtures/config/backtest.test.config.json');
  const reportsDir = path.join(repoRoot, 'reports/backtesting/test-smoke');
  await rm(reportsDir, { recursive: true, force: true });

  const result = await runNodeScript('scripts/backtest/run-backtests.js', ['--config', configPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Backtesting completed/);

  const files = await readdir(reportsDir);
  assert.ok(files.some((name) => name.endsWith('.json')));

  await rm(reportsDir, { recursive: true, force: true });
});
