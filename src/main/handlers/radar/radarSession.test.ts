import type { Request, Session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRadarSession, RADAR_SESSION_PARTITION } from './radarSession';
import { openRadarSignIn, resetRadarSignInWindow } from './radarSignInWindow';

const mocks = vi.hoisted(() => {
  const radarSession = {
    setCertificateVerifyProc: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  };
  return {
    radarSession,
    fromPartition: vi.fn(() => radarSession),
    windowOptions: vi.fn(),
  };
});

vi.mock('electron', () => ({
  session: { fromPartition: mocks.fromPartition },
  BrowserWindow: class {
    constructor(options: unknown) {
      mocks.windowOptions(options);
    }
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    on = vi.fn();
    loadURL = vi.fn(async () => {});
  },
}));
vi.mock('../../logger', () => ({ loggers: { security: { warn: vi.fn() } } }));

beforeEach(() => {
  vi.clearAllMocks();
  resetRadarSignInWindow();
});

describe('Radar certificate exception', () => {
  it.each([
    ['cw-intra-web', -202, 0],
    ['cw-intra-web', 0, -3],
    ['cw-intra-web', -200, -3], // hostname mismatch
    ['cw-intra-web', -201, -3], // expired
    ['cw-intra-web', -206, -3], // revoked
    ['cw-intra-web.example.com', -202, -3],
    ['other.cw-intra-web', -202, -3],
    ['github.com', -202, -3],
    ['', -202, -3],
  ])('verifies %s with Chromium error %i using result %i', (hostname, errorCode, expected) => {
    expect(getRadarSession()).toBe(mocks.radarSession);
    expect(mocks.fromPartition).toHaveBeenCalledWith(RADAR_SESSION_PARTITION);
    const verify = mocks.radarSession.setCertificateVerifyProc.mock.calls[0]![0] as NonNullable<
      Parameters<Session['setCertificateVerifyProc']>[0]
    >;
    const callback = vi.fn();
    verify({ hostname, errorCode } as Request, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('initializes the same hardened session when sign-in opens before polling', async () => {
    expect(await openRadarSignIn()).toBe(true);
    expect(mocks.radarSession.setCertificateVerifyProc).toHaveBeenCalledOnce();
    expect(mocks.windowOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          session: mocks.radarSession,
          webSecurity: true,
          sandbox: true,
        }),
      }),
    );
  });
});
