#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

function fail(message) {
  console.error(`Coverage quality gate failed: ${message}`);
  process.exit(1);
}

function parseCoverageSummary(output) {
  // Node's experimental coverage prints a table with a line like:
  // all files |  32.94 |  56.08 |  26.21 |
  const lines = output.split(/\r?\n/);
  const summaryLine = lines.find((line) => /\ball files\b/.test(line) && line.includes('|'));
  if (!summaryLine) {
    return null;
  }

  const parts = summaryLine
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  // Expected: ['all files', '32.94', '56.08', '26.21']
  const linePct = Number.parseFloat(parts[1]);
  const branchPct = Number.parseFloat(parts[2]);
  const funcPct = Number.parseFloat(parts[3]);

  if (!Number.isFinite(linePct) || !Number.isFinite(branchPct) || !Number.isFinite(funcPct)) {
    return null;
  }

  return { lines: linePct, branches: branchPct, funcs: funcPct };
}

async function loadBaseline(projectRoot) {
  const baselinePath = path.join(projectRoot, 'config', 'coverage-baseline.json');
  const raw = await fs.readFile(baselinePath, 'utf8');
  const baseline = JSON.parse(raw);

  const required = ['lines', 'branches', 'funcs'];
  for (const key of required) {
    if (!Number.isFinite(baseline[key])) {
      fail(`Invalid baseline in ${baselinePath} for ${key}`);
    }
  }

  return { baselinePath, baseline };
}

function getCommand() {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm run -s test:coverage'],
      useShell: false
    };
  }

  return {
    command: 'npm',
    args: ['run', '-s', 'test:coverage'],
    useShell: false
  };
}

async function runCoverage() {
  const { command, args, useShell } = getCommand();

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
      shell: useShell
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      resolve({ code, output });
    });
  });
}

function ensureNotBelow(current, baseline, epsilon = 0.01) {
  const keys = /** @type {const} */ (['lines', 'branches', 'funcs']);
  const failures = [];
  for (const key of keys) {
    if (current[key] + epsilon < baseline[key]) {
      failures.push(`${key} ${current[key].toFixed(2)} < baseline ${baseline[key].toFixed(2)}`);
    }
  }
  return failures;
}

async function main() {
  const projectRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
  const { baselinePath, baseline } = await loadBaseline(projectRoot);

  const { code, output } = await runCoverage();
  if (code !== 0) {
    fail(`coverage command failed with exit code ${code}`);
  }

  const summary = parseCoverageSummary(output);
  if (!summary) {
    fail('Unable to parse coverage summary from output');
  }

  const epsilon = Number.parseFloat(process.env.COVERAGE_EPSILON || '0.25');
  const failures = ensureNotBelow(summary, baseline, Number.isFinite(epsilon) ? epsilon : 0.25);
  if (failures.length > 0) {
    fail(`Coverage regressed vs baseline (${baselinePath}): ${failures.join('; ')}`);
  }

  console.log(
    `Coverage gate passed (baseline): lines=${summary.lines.toFixed(2)} branches=${summary.branches.toFixed(
      2
    )} funcs=${summary.funcs.toFixed(2)}`
  );
}

main().catch((error) => {
  fail(error?.message || String(error));
});
