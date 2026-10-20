import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WINDOWS_PACKAGE_PATHS,
  touchesWindowsPackage,
  windowsPackageRequired,
} from './windows-package-scope.mjs';

const script = path.resolve(import.meta.dirname, 'windows-package-scope.mjs');
const root = path.resolve(import.meta.dirname, '..');

describe('Windows package scope', () => {
  it.each([
    'src/main/releases/ReleaseUpdateManager.ts',
    'src/main/app/relaunch.ts',
    'src/main/index.ts',
    'src/main/pocketbase/WindowsPrivateDirectory.ts',
    'src/main/power/keepAwake.ts',
    'build/windows/installer.nsh',
    'electron-builder.yml',
    'package-lock.json',
    'scripts/windows-bootstrap-smoke.ps1',
    '.github/workflows/reusable-windows-package.yml',
  ])('requires the Windows package for %s', (file) => {
    expect(windowsPackageRequired('pull_request', ['docs/README.md', file])).toBe(true);
  });

  it.each([
    'src/renderer/src/App.tsx',
    'src/main/sdp/client.ts',
    'src/main/index.test.tsx',
    'docs/DEVELOPMENT.md',
    'scripts/package-windows.test.mjs',
    'buildtools/notes.txt',
    'src/main/releasesExtra.ts',
  ])('skips the Windows package for %s', (file) => {
    expect(windowsPackageRequired('pull_request', [file])).toBe(false);
  });

  it('always packages on manual dispatch and never on main pushes', () => {
    expect(windowsPackageRequired('workflow_dispatch')).toBe(true);
    expect(windowsPackageRequired('push')).toBe(false);
  });

  it('fails closed on unknown events and missing pull request file lists', () => {
    expect(() => windowsPackageRequired('schedule', [])).toThrow(/Unsupported event/u);
    expect(() => windowsPackageRequired('pull_request')).toThrow(/changed files/u);
  });

  it('lists only paths that exist, so a rename cannot silently drop coverage', () => {
    for (const entry of WINDOWS_PACKAGE_PATHS) {
      expect(existsSync(path.join(root, entry)), entry).toBe(true);
    }
    expect(touchesWindowsPackage([])).toBe(false);
  });

  it('writes the decision to GITHUB_OUTPUT from a changed-file list', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'relay-windows-scope-'));
    try {
      const list = path.join(directory, 'changed.txt');
      const output = path.join(directory, 'output.txt');
      writeFileSync(list, 'docs/README.md\r\nsrc/main/releases/ReleaseUpdateManager.ts\n');
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, [script, list], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('required=true\n');

      writeFileSync(output, '');
      const failed = spawnSync(process.execPath, [script, path.join(directory, 'missing.txt')], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output },
      });
      expect(failed.status).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
