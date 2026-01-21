#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const DASH_ROOT = path.join(projectRoot, 'clients', 'neon-dashboard');
const SRC_DIR = path.join(DASH_ROOT, 'src');

const extsToTry = ['.js', '.jsx', '.mjs', '.cjs'];

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
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === '.vite'
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

const resolveSpecifier = (fromFile, spec) => {
  if (!spec || typeof spec !== 'string') {
    return null;
  }

  if (!spec.startsWith('.')) {
    return null;
  }

  // Ignore style/assets; they can be imported but are not module candidates.
  if (/\.(css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(spec)) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, spec);

  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }

  for (const ext of extsToTry) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

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

    const specs = extractSpecifiers(code);
    for (const spec of specs) {
      const dep = resolveSpecifier(resolvedCurrent, spec);
      if (!dep) {
        continue;
      }
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

  const entry = path.join(SRC_DIR, 'main.jsx');
  if (!fs.existsSync(entry)) {
    console.error('Expected entry not found:', path.relative(projectRoot, entry));
    process.exitCode = 2;
    return;
  }

  const roots = [entry];
  const reachable = buildReachableGraph(roots);
  const allSrc = listAllSrcModuleFiles().map((p) => safeRealpath(p));

  const unused = allSrc
    .filter((p) => !reachable.has(p))
    .map((p) => path.relative(projectRoot, p).replaceAll('\\', '/'))
    .sort();

  console.log('--- Unused dashboard src modules report ---');
  console.log(`Roots scanned: ${roots.length}`);
  console.log(`Reachable modules: ${reachable.size}`);
  console.log(`All dashboard src modules: ${allSrc.length}`);
  console.log(`Unused dashboard src modules: ${unused.length}`);
  console.log('');

  if (!unused.length) {
    console.log('No unused dashboard src modules detected.');
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
