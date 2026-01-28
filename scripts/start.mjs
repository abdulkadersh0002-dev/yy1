#!/usr/bin/env node
/**
 * Unified Start Script
 * Starts both backend and dashboard with one command
 * Cross-platform compatible (Windows, Linux, Mac)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load environment
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const BACKEND_PORT = Number(process.env.PORT || 4101);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 4173);
const CHECK_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 60000;

// Console colors for better visibility
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, colors.bright);
  console.log('='.repeat(60) + '\n');
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${port}/api/healthz`;
    const req = http.request(url, { method: 'GET', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForService(name, port, maxWaitMs = MAX_WAIT_MS) {
  const startTime = Date.now();
  log(`⏳ Waiting for ${name} on port ${port}...`, colors.yellow);
  
  while (Date.now() - startTime < maxWaitMs) {
    if (await checkPort(port)) {
      log(`✅ ${name} is ready!`, colors.green);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
  
  log(`❌ ${name} failed to start within ${maxWaitMs / 1000}s`, colors.red);
  return false;
}

function startProcess(name, command, args, env = {}) {
  log(`🚀 Starting ${name}...`, colors.blue);
  
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env }
  });

  proc.on('error', (err) => {
    log(`❌ Failed to start ${name}: ${err.message}`, colors.red);
  });

  return proc;
}

async function main() {
  logSection('🎯 Starting Intelligent Auto-Trading System');

  log('📦 Configuration:', colors.blue);
  log(`   Backend Port:   ${BACKEND_PORT}`);
  log(`   Dashboard Port: ${DASHBOARD_PORT}`);
  log(`   Node Version:   ${process.version}\n`);

  // Start backend
  const backend = startProcess(
    'Backend',
    'node',
    ['src/server.js']
  );

  // Wait for backend to be ready
  const backendReady = await waitForService('Backend', BACKEND_PORT);
  
  if (!backendReady) {
    log('\n❌ Backend failed to start. Please check logs above.', colors.red);
    backend.kill();
    process.exit(1);
  }

  // Start dashboard
  const dashboard = startProcess(
    'Dashboard',
    'npm',
    ['run', 'dashboard:dev'],
    { FORCE_COLOR: '1' }
  );

  // Wait for dashboard
  const dashboardReady = await waitForService('Dashboard', DASHBOARD_PORT);

  if (!dashboardReady) {
    log('\n⚠️  Dashboard may still be starting. Check http://127.0.0.1:' + DASHBOARD_PORT, colors.yellow);
  }

  // Success message
  logSection('✅ System Ready!');
  log('🌐 Access your application:', colors.green);
  log(`   Backend API:  http://127.0.0.1:${BACKEND_PORT}`);
  log(`   Dashboard:    http://127.0.0.1:${DASHBOARD_PORT}`);
  log(`   Health Check: http://127.0.0.1:${BACKEND_PORT}/api/healthz`);
  log(`   WebSocket:    ws://127.0.0.1:${BACKEND_PORT}/ws/trading`);
  log('\n💡 Press Ctrl+C to stop both services\n');

  // Handle shutdown
  const cleanup = () => {
    log('\n\n🛑 Shutting down...', colors.yellow);
    backend.kill();
    dashboard.kill();
    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, colors.red);
  console.error(error);
  process.exit(1);
});
