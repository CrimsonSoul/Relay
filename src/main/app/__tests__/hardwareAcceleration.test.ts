import { describe, expect, it, vi } from 'vitest';
import {
  configureElectronPerformancePolicy,
  configureHardwareAcceleration,
  shouldDisableHardwareAcceleration,
} from '../hardwareAcceleration';

function createMockApp(isPackaged: boolean) {
  return {
    isPackaged,
    disableHardwareAcceleration: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
  };
}

describe('hardwareAcceleration', () => {
  it('keeps the Windows occlusion optimization without imposing V8 or GPU-selection flags', () => {
    const app = createMockApp(true);

    configureElectronPerformancePolicy(app, { platform: 'win32' });

    expect(app.commandLine.appendSwitch).toHaveBeenCalledExactlyOnceWith(
      'disable-features',
      'CalculateNativeWinOcclusion',
    );
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith('js-flags', expect.anything());
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith(
      'force_high_performance_gpu',
      expect.anything(),
    );
  });

  it('does not apply the Windows policy on other platforms', () => {
    const app = createMockApp(true);

    configureElectronPerformancePolicy(app, { platform: 'darwin' });

    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('keeps hardware acceleration enabled for packaged Windows builds by default', () => {
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'win32',
        isPackaged: true,
        disableEnv: undefined,
      }),
    ).toBe(false);
  });

  it('does not disable hardware acceleration for unpackaged Windows development builds by default', () => {
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'win32',
        isPackaged: false,
        disableEnv: undefined,
      }),
    ).toBe(false);
  });

  it('does not disable hardware acceleration for packaged macOS builds by default', () => {
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'darwin',
        isPackaged: true,
        disableEnv: undefined,
      }),
    ).toBe(false);
  });

  it('honors the explicit disable environment variable on every platform', () => {
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'darwin',
        isPackaged: false,
        disableEnv: '1',
      }),
    ).toBe(true);
  });

  it('applies Electron GPU switches only when explicitly disabled via the environment', () => {
    const app = createMockApp(true);

    const enabledByDefault = configureHardwareAcceleration(app, {
      platform: 'win32',
      env: {},
    });
    expect(enabledByDefault).toBe(false);
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();

    const disabledByEnv = configureHardwareAcceleration(app, {
      platform: 'win32',
      env: { RELAY_DISABLE_HARDWARE_ACCELERATION: '1' },
    });
    expect(disabledByEnv).toBe(true);
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-compositing');
  });
});
