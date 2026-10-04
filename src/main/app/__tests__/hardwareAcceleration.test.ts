import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureHardwareAcceleration } from '../hardwareAcceleration';

function createMockApp() {
  return {
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
  afterEach(() => vi.unstubAllEnvs());
  it('reads the machine environment when called without options', () => {
    vi.stubEnv('RELAY_DISABLE_HARDWARE_ACCELERATION', '1');
    const app = createMockApp();
    expect(configureHardwareAcceleration(app)).toBe(true);
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-compositing');
  });

  it('applies Electron GPU switches only when explicitly disabled via the environment', () => {
    const app = createMockApp();

    const enabledByDefault = configureHardwareAcceleration(app, {});
    expect(enabledByDefault).toBe(false);
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();

    const disabledByEnv = configureHardwareAcceleration(app, {
      RELAY_DISABLE_HARDWARE_ACCELERATION: '1',
    });
    expect(disabledByEnv).toBe(true);
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-compositing');
  });
});
