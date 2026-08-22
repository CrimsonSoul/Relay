import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const rootNodeModules = path.join(repositoryRoot, 'node_modules');
const requireFromTest = createRequire(import.meta.url);

function markNodeModulesVisited(nodeModulesPath, visited) {
  try {
    const realPath = path.resolve(nodeModulesPath);
    if (visited.has(realPath)) return false;
    visited.add(realPath);
    return true;
  } catch {
    return false;
  }
}

function visitPackage(packagePath, packageName, matches, visited) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  if (!existsSync(packageJsonPath)) return;

  if (path.basename(packagePath) === packageName) matches.push(packagePath);

  const nestedNodeModules = path.join(packagePath, 'node_modules');
  if (existsSync(nestedNodeModules)) {
    visitNodeModules(nestedNodeModules, packageName, matches, visited);
  }
}

function visitScope(scopePath, packageName, matches, visited) {
  for (const entry of readdirSync(scopePath, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    visitPackage(path.join(scopePath, entry.name), packageName, matches, visited);
  }
}

function visitNodeModules(nodeModulesPath, packageName, matches, visited) {
  if (!markNodeModulesVisited(nodeModulesPath, visited)) return;

  for (const entry of readdirSync(nodeModulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith('@')) {
      visitScope(entryPath, packageName, matches, visited);
    } else {
      visitPackage(entryPath, packageName, matches, visited);
    }
  }
}

function packageDirectories(packageName) {
  const matches = [];
  visitNodeModules(rootNodeModules, packageName, matches, new Set());
  return matches.sort();
}

function packageJson(packagePath) {
  return JSON.parse(readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
}

function conditionalExport(packagePath, condition) {
  const manifest = packageJson(packagePath);
  let target = manifest.exports?.['.'] ?? manifest.exports;
  target = target?.[condition] ?? target;
  target = target?.default ?? target;

  if (typeof target === 'string') return path.join(packagePath, target);

  const fallback = condition === 'import' ? manifest.module : manifest.main;
  return path.join(packagePath, fallback ?? 'index.js');
}

function resolveNpmCliPath() {
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    path.resolve(nodeDirectory, '../node_modules/npm/bin/npm-cli.js'),
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));
  const npmCliPath = candidates.find((candidate) => existsSync(candidate));

  assert.ok(npmCliPath, `expected an npm CLI installed alongside ${process.execPath}`);
  return npmCliPath;
}

const braceExpansionInstalls = packageDirectories('brace-expansion');

test('npm reports no extraneous, invalid, or unmet required dependencies', () => {
  const npmCliPath = resolveNpmCliPath();
  const result = spawnSync(process.execPath, [npmCliPath, 'ls', '--all', '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  const tree = JSON.parse(result.stdout);

  assert.deepEqual(tree.problems ?? [], []);
});

test('the dependency tree includes brace-expansion for compatibility verification', () => {
  assert.ok(braceExpansionInstalls.length > 0, 'expected at least one brace-expansion install');
});

test('PostCSS can load through the Snyk-safe nanoid release', async () => {
  const nanoidPath = path.dirname(requireFromTest.resolve('nanoid/package.json'));
  assert.equal(packageJson(nanoidPath).version, '5.1.16');

  const postcss = requireFromTest('postcss');
  const result = await postcss([]).process('a { color: red }', { from: undefined });
  assert.equal(result.css, 'a { color: red }');
});

for (const packagePath of braceExpansionInstalls) {
  const relativePath = path.relative(repositoryRoot, packagePath);

  test(`${relativePath} uses the patched algorithm and compatible exports`, async () => {
    assert.equal(packageJson(packagePath).version, '5.0.9', `${relativePath} must be patched`);

    const commonJsExport = createRequire(import.meta.url)(
      conditionalExport(packagePath, 'require'),
    );
    assert.equal(
      typeof commonJsExport,
      'function',
      `${relativePath} must be callable from CommonJS`,
    );
    assert.equal(commonJsExport.expand, commonJsExport);
    assert.deepEqual(commonJsExport('{a,b}{c,d}', { max: 3 }), ['ac', 'ad', 'bc']);
    assert.deepEqual(commonJsExport('{a,b}{c,d}', { maxLength: 3 }), ['ac']);

    const esmExport = await import(pathToFileURL(conditionalExport(packagePath, 'import')).href);
    assert.equal(typeof esmExport.default, 'function', `${relativePath} must have an ESM default`);
    assert.equal(esmExport.expand, esmExport.default);
    assert.deepEqual(esmExport.expand('file-{1..3}.txt'), [
      'file-1.txt',
      'file-2.txt',
      'file-3.txt',
    ]);
  });
}

const legacyMinimatchInstalls = packageDirectories('minimatch').filter((packagePath) => {
  const manifest = packageJson(packagePath);
  return Number.parseInt(manifest.version, 10) <= 5 && manifest.dependencies?.['brace-expansion'];
});

test('legacy minimatch consumers can expand braces through their installed CommonJS paths', () => {
  assert.ok(legacyMinimatchInstalls.length > 0, 'expected at least one legacy minimatch install');

  for (const packagePath of legacyMinimatchInstalls) {
    const relativePath = path.relative(repositoryRoot, packagePath);
    const minimatchExport = createRequire(import.meta.url)(packagePath);
    assert.equal(
      typeof minimatchExport,
      'function',
      `${relativePath} must expose legacy minimatch`,
    );
    assert.equal(minimatchExport('alpha.js', '{alpha,beta}.js'), true);
    assert.equal(minimatchExport('beta.js', '{alpha,beta}.js'), true);
    assert.equal(minimatchExport('gamma.js', '{alpha,beta}.js'), false);
  }
});
