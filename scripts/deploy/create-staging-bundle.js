#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function parseTestSummary(rawSummary) {
  if (!rawSummary) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawSummary);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // Fall back to string parsing below.
  }

  return rawSummary
    .split(/[,;|]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

async function ensureCleanDirectory(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
}

async function copyIfExists(sourcePath, destinationPath) {
  try {
    await fs.copyFile(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeFile(targetPath, contents) {
  await fs.writeFile(targetPath, contents, 'utf8');
}

async function buildManifest(stagingDir) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    gitSha: process.env.GITHUB_SHA || null,
    gitRef: process.env.GITHUB_REF_NAME || null,
    dockerImageTag: process.env.DOCKER_IMAGE_TAG || null,
    dockerImageDigest: process.env.IMAGE_DIGEST || null,
    testsExecuted: parseTestSummary(process.env.PIPELINE_TEST_SUMMARY),
    nodeVersion: process.version,
    notes: 'Update DOCKER_IMAGE_TAG and deployment steps if promotion targets change.'
  };

  await writeFile(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeReadme(stagingDir) {
  const readme =
    `# Staging Deployment Bundle\n\n` +
    `## Docker Image\n` +
    `- Tag: ${process.env.DOCKER_IMAGE_TAG || 'not provided'}\n` +
    `- Digest: ${process.env.IMAGE_DIGEST || 'not captured'}\n` +
    `- Source ref: ${process.env.GITHUB_REF_NAME || 'unknown'} (@ ${process.env.GITHUB_SHA || 'unknown'})\n\n` +
    `## What's Inside\n` +
    `- manifest.json — captured metadata for this bundle.\n` +
    `- Dockerfile / docker-compose.yml — production build definitions.\n` +
    `- env.template — staging environment variables to seed secrets.\n\n` +
    `## Promote to Staging\n` +
    `1. Load secrets into the target environment (see env.template).\n` +
    `2. Pull image tag listed above (or rebuild using the included Dockerfile).\n` +
    `3. Deploy via \`docker compose up -d\` to provision API + workers.\n` +
    `4. Run smoke tests against monitoring endpoints before promoting to production.\n\n` +
    `> This bundle is generated automatically by the CI pipeline. Any manual edits should be committed before re-running the workflow.\n`;

  await writeFile(path.join(stagingDir, 'README.md'), `${readme}\n`);
}

async function main() {
  const stagingDir = path.resolve('dist', 'staging');
  await ensureCleanDirectory(stagingDir);

  await buildManifest(stagingDir);
  await writeReadme(stagingDir);

  const filesToCopy = [
    { source: path.resolve('Dockerfile'), target: path.join(stagingDir, 'Dockerfile') },
    {
      source: path.resolve('docker-compose.yml'),
      target: path.join(stagingDir, 'docker-compose.yml')
    },
    { source: path.resolve('.env.example'), target: path.join(stagingDir, 'env.template') }
  ];

  for (const entry of filesToCopy) {
    await copyIfExists(entry.source, entry.target);
  }

  console.log(`Staging bundle ready at ${stagingDir}`);
}

main().catch((error) => {
  console.error('Failed to create staging bundle:', error);
  process.exit(1);
});
