import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(file, 'utf8');

describe('Relay distribution platform contract', () => {
  it('ships Windows releases without retaining Mac package entry points or assets', () => {
    const packageJson = JSON.parse(read('package.json'));
    const builder = read('electron-builder.yml');
    const workflow = read('.github/workflows/build.yml');
    const iconGenerator = read('scripts/generate-icons.mjs');

    expect(packageJson.scripts).not.toHaveProperty('build:mac');
    expect(builder).not.toMatch(/^mac:/mu);
    expect(builder).not.toContain('resetAdHocDarwinSignature');
    expect(workflow).not.toContain('package-mac:');
    expect(workflow).not.toContain('macos-latest');
    expect(workflow).not.toContain('relay-mac');
    expect(iconGenerator).not.toContain('icon.icns');
    expect(existsSync('build/icon.icns')).toBe(false);
    expect(existsSync('build/entitlements.mac.plist')).toBe(false);
  });

  it('preserves macOS local development and Darwin PocketBase support', () => {
    const packageJson = JSON.parse(read('package.json'));
    const pocketBaseDownloader = read('scripts/download-pocketbase.mjs');
    const development = read('docs/DEVELOPMENT.md');

    expect(packageJson.scripts.dev).toBe('ELECTRON_RUN_AS_NODE= electron-vite dev');
    expect(packageJson.scripts['test:electron']).toBe('node scripts/run-electron-tests.mjs');
    expect(pocketBaseDownloader).toContain("value === 'darwin'");
    expect(development).toContain('macOS remains a supported local development host');
    expect(development).toContain('resources/pocketbase/darwin-arm64/pocketbase');
    expect(development).toContain('resources/pocketbase/darwin-x64/pocketbase');
  });
});
