import { describe, expect, it, vi } from 'vitest';
import { configureE2EDesktopIsolation } from './e2eSafety';

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
