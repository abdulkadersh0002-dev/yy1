#!/usr/bin/env node
import 'dotenv/config';
import ClientUserService from '../src/services/client-auth/user-service.js';
import { closePool } from '../src/storage/database.js';

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { roles: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  if (typeof options.roles === 'string') {
    options.roles = options.roles
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean);
  } else if (!Array.isArray(options.roles) || options.roles.length === 0) {
    options.roles = [];
  }
  return options;
}

async function main() {
  const { username, password, roles } = parseArgs(process.argv);
  if (!username || !password) {
    console.error(
      'Usage: node scripts/create-client-user.mjs --username user@example.com --password secret [--roles operator,admin]'
    );
    process.exitCode = 1;
    return;
  }

  const service = new ClientUserService({ logger: console });

  try {
    const user = await service.createUser({
      username,
      password,
      roles: roles.length > 0 ? roles : ['operator', 'admin']
    });
    console.log('Client user created:', {
      id: user.id,
      username: user.username,
      roles: user.roles,
      status: user.status
    });
  } catch (error) {
    console.error('Failed to create user:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await main();
