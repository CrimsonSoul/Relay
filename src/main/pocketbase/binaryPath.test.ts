import { describe, expect, it } from 'vitest';
import { getPocketBaseBinaryPath } from './binaryPath';

describe('getPocketBaseBinaryPath', () => {
  it('uses an arch-specific resource path for packaged Windows builds', () => {
    expect(
      getPocketBaseBinaryPath({
        isPackaged: true,
        appRoot: '/app',
        resourcesPath: '/resources',
        platform: 'win32',
        arch: 'x64',
      }),
    ).toBe('/resources/pocketbase/win32-x64/pocketbase.exe');
  });

  it('uses an arch-specific resource path for packaged macOS builds', () => {
    expect(
      getPocketBaseBinaryPath({
        isPackaged: true,
        appRoot: '/app',
        resourcesPath: '/resources',
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).toBe('/resources/pocketbase/darwin-arm64/pocketbase');
  });

  it('uses the dev resources path when not packaged', () => {
    expect(
      getPocketBaseBinaryPath({
        isPackaged: false,
        appRoot: '/repo',
        resourcesPath: '/resources',
        platform: 'darwin',
        arch: 'x64',
      }),
    ).toBe('/repo/resources/pocketbase/darwin-x64/pocketbase');
  });
});
