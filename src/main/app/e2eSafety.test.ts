import { describe, expect, it, vi } from 'vitest';
import { configureE2EDesktopIsolation, configureE2EHiddenWindowRendering } from './e2eSafety';

describe('configureE2EDesktopIsolation', () => {
  it('uses accessory activation policy for macOS E2E processes', () => {
    const application = { setActivationPolicy: vi.fn() };

    expect(
      configureE2EDesktopIsolation(application, 'darwin', {
        NODE_ENV: 'test',
        RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS: '1',
      }),
    ).toBe(true);
    expect(application.setActivationPolicy).toHaveBeenCalledOnce();
    expect(application.setActivationPolicy).toHaveBeenCalledWith('accessory');
  });

  it('does not alter ordinary app activation', () => {
    const application = { setActivationPolicy: vi.fn() };

    expect(configureE2EDesktopIsolation(application, 'darwin', {})).toBe(false);
    expect(application.setActivationPolicy).not.toHaveBeenCalled();
  });

  it('does not call the macOS-only API on other platforms', () => {
    const application = { setActivationPolicy: vi.fn() };

    expect(
      configureE2EDesktopIsolation(application, 'win32', {
        NODE_ENV: 'test',
        RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS: '1',
      }),
    ).toBe(false);
    expect(application.setActivationPolicy).not.toHaveBeenCalled();
  });
});

describe('configureE2EHiddenWindowRendering', () => {
  const e2eEnvironment = { NODE_ENV: 'test', RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS: '1' };

  it('unpaces rendering for hidden Windows E2E windows', () => {
    const commandLine = { appendSwitch: vi.fn() };

    expect(configureE2EHiddenWindowRendering(commandLine, 'win32', e2eEnvironment)).toBe(true);
    expect(commandLine.appendSwitch.mock.calls).toEqual([
      ['disable-gpu-vsync'],
      ['disable-frame-rate-limit'],
    ]);
  });

  it('keeps normal frame pacing outside Windows E2E runs', () => {
    const commandLine = { appendSwitch: vi.fn() };

    expect(configureE2EHiddenWindowRendering(commandLine, 'win32', {})).toBe(false);
    expect(
      configureE2EHiddenWindowRendering(commandLine, 'win32', { NODE_ENV: 'production' }),
    ).toBe(false);
    expect(configureE2EHiddenWindowRendering(commandLine, 'darwin', e2eEnvironment)).toBe(false);
    expect(configureE2EHiddenWindowRendering(commandLine, 'linux', e2eEnvironment)).toBe(false);
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
