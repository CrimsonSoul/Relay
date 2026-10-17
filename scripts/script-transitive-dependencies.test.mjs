import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Build and verification scripts import these packages, or files inside them, without a
// direct package.json declaration. They arrive through electron-builder's dependency tree,
// so this contract fails loudly if a lockfile change stops installing them.
const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

const TRANSITIVE_SCRIPT_DEPENDENCIES = [
  {
    name: 'pe-library',
    parent: 'resedit',
    importers: ['scripts/verify-windows-pe.mjs'],
    importPattern: /from 'pe-library'/u,
    files: [],
  },
  {
    name: '@electron/fuses',
    parent: 'app-builder-lib',
    importers: ['scripts/verify-packaged-windows-sqlite.mjs'],
    importPattern: /from '@electron\/fuses\/dist\/constants\.js'/u,
    files: ['dist/constants.js'],
  },
  {
    name: 'app-builder-lib',
    parent: 'electron-builder',
    importers: ['scripts/package-windows.mjs'],
    importPattern: /require\('app-builder-lib\/out\/toolsets\/windows\.js'\)/u,
    files: ['out/toolsets/windows.js', 'templates/nsis/include'],
  },
  {
    name: '@electron/rebuild',
    parent: 'app-builder-lib',
    importers: ['scripts/run-electron-tests.mjs', 'scripts/run-web-tests.mjs'],
    importPattern: /'@electron', 'rebuild', 'lib', 'cli\.js'/u,
    files: ['lib/cli.js'],
  },
];

describe('transitive packages used by scripts', () => {
  it.each(TRANSITIVE_SCRIPT_DEPENDENCIES)(
    '$name is installed by the lockfile through $parent',
    ({ name, parent, importers, importPattern, files }) => {
      const entry = lockfile.packages[`node_modules/${name}`];
      expect(entry?.version, `${name} is missing from package-lock.json`).toEqual(
        expect.any(String),
      );
      expect(lockfile.packages[`node_modules/${parent}`]?.dependencies?.[name]).toEqual(
        expect.any(String),
      );
      expect(packageJson.dependencies?.[name]).toBeUndefined();
      expect(packageJson.devDependencies?.[name]).toBeUndefined();

      for (const importer of importers) {
        expect(readFileSync(join(root, importer), 'utf8')).toMatch(importPattern);
      }

      const packageRoot = join(root, 'node_modules', ...name.split('/'));
      const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      expect(installed.version).toBe(entry.version);
      for (const file of files) {
        expect(existsSync(join(packageRoot, file)), `${name}/${file} is missing`).toBe(true);
      }
    },
  );

  it('resolves the bare package imports that scripts use', () => {
    expect(() => require.resolve('pe-library')).not.toThrow();
    expect(() => require.resolve('@electron/fuses')).not.toThrow();
    expect(() => require.resolve('app-builder-lib/out/toolsets/windows.js')).not.toThrow();
  });
});
