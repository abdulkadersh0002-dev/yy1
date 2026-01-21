#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

const SRC_DIR = path.join(projectRoot, 'src');
const TESTS_DIR = path.join(projectRoot, 'tests');
const SCRIPTS_DIR = path.join(projectRoot, 'scripts');

const extsToTry = ['.js', '.mjs', '.cjs'];

const isWithin = (candidate, parent) => {
  const rel = path.relative(parent, candidate);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const safeRealpath = (filePath) => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
};

const readTextSafe = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
};

const listFilesRecursive = (dirPath) => {
  const results = [];
  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Skip common junk
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'coverage'
      ) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  return results;
};

const isModuleFile = (filePath) => extsToTry.includes(path.extname(filePath));

const extractSpecifiers = (code) => {
  const specs = [];
  const patterns = [
    // Support multi-line import statements (default + named imports etc)
    /\bimport\s+[\s\S]*?\sfrom\s+['"](.+?)['"]/g,
    /\bexport\s+[\s\S]*?\sfrom\s+['"](.+?)['"]/g,
    /\bimport\(\s*['"](.+?)['"]\s*\)/g,
    /\brequire\(\s*['"](.+?)['"]\s*\)/g
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(code)) != null) {
      specs.push(match[1]);
    }
  }

  return specs;
};

const extractLocalModuleStrings = (code) => {
  // Conservative: only capture relative string literals that look like module files.
  const specs = [];
  const re = /['"](\.{1,2}\/[^'"\n]+?\.(?:js|mjs|cjs))['"]/g;
  let match;
  while ((match = re.exec(code)) != null) {
    specs.push(match[1]);
  }
  return specs;
};

const resolveSpecifier = (fromFile, spec) => {
  if (!spec || typeof spec !== 'string') {
    return null;
  }
  if (!spec.startsWith('.')) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, spec);

  // Exact file exists
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }

  // Try extensions
  for (const ext of extsToTry) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Directory index
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of extsToTry) {
      const candidate = path.join(base, `index${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  return null;
};

const getRoots = () => {
  const roots = [];

  const serverEntry = path.join(SRC_DIR, 'server.js');
  if (fs.existsSync(serverEntry)) {
    roots.push(serverEntry);
  }

  for (const file of listFilesRecursive(TESTS_DIR)) {
    if (isModuleFile(file)) {
      roots.push(file);
    }
  }

  for (const file of listFilesRecursive(SCRIPTS_DIR)) {
    if (isModuleFile(file)) {
      roots.push(file);
    }
  }

  return roots;
};

const buildReachableGraph = (roots) => {
  const visited = new Set();
  const queue = roots.slice();

  while (queue.length) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const resolvedCurrent = safeRealpath(current);
    if (visited.has(resolvedCurrent)) {
      continue;
    }

    visited.add(resolvedCurrent);

    const code = readTextSafe(resolvedCurrent);
    if (code == null) {
      continue;
    }

    const specs = [...extractSpecifiers(code), ...extractLocalModuleStrings(code)];
    for (const spec of specs) {
      const dep = resolveSpecifier(resolvedCurrent, spec);
      if (!dep) {
        continue;
      }
      // Only chase within this repo to avoid weirdness
      if (!isWithin(dep, projectRoot)) {
        continue;
      }
      const depReal = safeRealpath(dep);
      if (!visited.has(depReal)) {
        queue.push(depReal);
      }
    }
  }

  return visited;
};

const listAllSrcModuleFiles = () => {
  return listFilesRecursive(SRC_DIR).filter((file) => isModuleFile(file));
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  const shouldDelete = args.has('--delete');

  const roots = getRoots();
  const reachable = buildReachableGraph(roots);
  const allSrc = listAllSrcModuleFiles().map((p) => safeRealpath(p));

  const unused = allSrc
    .filter((p) => !reachable.has(p))
    .map((p) => path.relative(projectRoot, p).replaceAll('\\', '/'))
    .sort();

  const rootRel = roots.map((p) => path.relative(projectRoot, p).replaceAll('\\', '/')).sort();

  console.log('--- Unused src modules report ---');
  console.log(`Roots scanned: ${rootRel.length}`);
  console.log(`Reachable modules: ${reachable.size}`);
  console.log(`All src modules: ${allSrc.length}`);
  console.log(`Unused src modules: ${unused.length}`);
  console.log('');

  if (!unused.length) {
    console.log('No unused src/*.js modules detected.');
    return;
  }

  for (const rel of unused) {
    console.log(rel);
  }

  if (!shouldDelete) {
    console.log('');
    console.log('Dry-run only. Re-run with --delete to remove these files.');
    return;
  }

  // Delete phase: intentionally conservative.
  let deletedCount = 0;
  for (const rel of unused) {
    const abs = path.join(projectRoot, rel);
    try {
      fs.unlinkSync(abs);
      deletedCount += 1;
    } catch {
      // ignore
    }
  }

  console.log('');
  console.log(`Deleted ${deletedCount}/${unused.length} unused files.`);
};

main();
