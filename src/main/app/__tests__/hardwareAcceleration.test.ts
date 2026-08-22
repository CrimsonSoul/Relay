import { describe, expect, it, vi } from 'vitest';
import {
  configureHardwareAcceleration,
  shouldDisableHardwareAcceleration,
} from '../hardwareAcceleration';

function createMockApp(isPackaged: boolean) {
  return {
    isPackaged,
    disableHardwareAcceleration: vi.fn(),
    // configureHardwareAcceleration takes Pick<App, 'commandLine' | ...>, so the
    // stub has to cover Electron's whole CommandLine surface even though only
    // appendSwitch is exercised here.
    commandLine: {
      appendSwitch: vi.fn(),
      appendArgument: vi.fn(),
      getSwitchValue: vi.fn(() => ''),
      hasSwitch: vi.fn(() => false),
      removeSwitch: vi.fn(),
    },
  };
}

describe('hardwareAcceleration', () => {
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
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();

    const disabledByEnv = configureHardwareAcceleration(app, {
      platform: 'win32',
      env: { RELAY_DISABLE_HARDWARE_ACCELERATION: '1' },
    });
    expect(disabledByEnv).toBe(true);
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-compositing');
  });
});
