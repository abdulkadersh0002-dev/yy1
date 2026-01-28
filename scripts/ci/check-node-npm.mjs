import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const details = [stderr, stdout].filter(Boolean).join('\n');
    const message = details
      ? `${cmd} ${args.join(' ')} failed:\n${details}`
      : `${cmd} ${args.join(' ')} failed`;
    const err = new Error(message);
    err.exitCode = result.status;
    throw err;
  }

  return (result.stdout || '').trim();
}

function runNpmVersion() {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    // On Windows, spawning npm.cmd directly can throw EINVAL.
    // Call through cmd.exe explicitly to avoid `shell: true` warnings.
    return run(comspec, ['/d', '/s', '/c', 'npm -v']);
  }

  return run('npm', ['-v']);
}

function main() {
  const nodeVersion = process.version;

  const npmVersion = runNpmVersion();

  // Output matches what most tasks/scripts expect.
  // (One per line, no extra text.)
  process.stdout.write(`${nodeVersion}\n${npmVersion}\n`);
}

try {
  main();
} catch (error) {
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = error && typeof error.exitCode === 'number' ? error.exitCode : 1;
}
