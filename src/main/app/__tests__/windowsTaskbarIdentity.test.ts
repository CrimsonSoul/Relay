import { describe, expect, it, vi } from 'vitest';
import {
  configureWindowsApplicationIdentity,
  configureWindowsTaskbarWindow,
} from '../windowsTaskbarIdentity';

describe('Windows taskbar identity', () => {
  it('relaunches a running packaged window through the stable Relay launcher', () => {
    const setAppDetails = vi.fn();

    configureWindowsTaskbarWindow(
      { setAppDetails },
      {
        platform: 'win32',
        isPackaged: true,
        execPath: String.raw`C:\Users\Ryan\AppData\Local\Relay\Runtime\r1-build\Relay.exe`,
      },
    );

    expect(setAppDetails).toHaveBeenCalledWith({
      appId: 'com.operators.relay',
      appIconPath: String.raw`C:\Users\Ryan\AppData\Local\Relay\Relay.exe`,
      appIconIndex: 0,
      relaunchCommand: String.raw`"C:\Users\Ryan\AppData\Local\Relay\Relay.exe"`,
      relaunchDisplayName: 'Relay',
    });
  });

  it('gives the packaged Windows process the same stable application identity', () => {
    const setAppUserModelId = vi.fn();

    configureWindowsApplicationIdentity(
      { setAppUserModelId },
      { platform: 'win32', isPackaged: true },
    );

    expect(setAppUserModelId).toHaveBeenCalledWith('com.operators.relay');
  });
});
