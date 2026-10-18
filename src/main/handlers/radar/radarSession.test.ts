import type { Request, Session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RADAR_URL } from '@shared/radar';
import { getRadarSession, RADAR_SESSION_PARTITION } from './radarSession';
import { openRadarSignIn, resetRadarSignInWindow } from './radarSignInWindow';

const mocks = vi.hoisted(() => {
  const createSession = () => ({
    setCertificateVerifyProc: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  });
  const state = {
    createSession,
    // Each test gets a fresh partition session, as a new process would.
    radarSession: createSession(),
    fromPartition: vi.fn((): unknown => state.radarSession),
    windowOptions: vi.fn(),
    webContentsOn: vi.fn(),
  };
  return state;
});

vi.mock('electron', () => ({
  session: { fromPartition: mocks.fromPartition },
  BrowserWindow: class {
    constructor(options: unknown) {
      mocks.windowOptions(options);
    }
    webContents = { on: mocks.webContentsOn, setWindowOpenHandler: vi.fn() };
    on = vi.fn();
    loadURL = vi.fn(async () => {});
  },
}));
vi.mock('../../logger', () => ({ loggers: { security: { warn: vi.fn() } } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.radarSession = mocks.createSession();
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

  it('installs the session handlers once across repeated polls', () => {
    getRadarSession();
    getRadarSession();
    getRadarSession();

    expect(mocks.radarSession.setCertificateVerifyProc).toHaveBeenCalledOnce();
    expect(mocks.radarSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(mocks.radarSession.setPermissionCheckHandler).toHaveBeenCalledOnce();
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

describe('Radar sign-in navigation guard', () => {
  const guard = (eventName: string) => {
    const call = mocks.webContentsOn.mock.calls.find(([name]) => name === eventName);
    if (!call) throw new Error(`No ${eventName} listener`);
    return call[1] as (event: { preventDefault: () => void }, url: string) => void;
  };

  it.each(['will-navigate', 'will-redirect'])(
    'keeps %s on the Radar origin and blocks everything else',
    async (eventName) => {
      await openRadarSignIn();
      const allowed = { preventDefault: vi.fn() };
      const blocked = { preventDefault: vi.fn() };

      guard(eventName)(allowed, `${new URL(RADAR_URL).origin}/sso/login`);
      guard(eventName)(blocked, 'https://evil.example/phish');

      expect(allowed.preventDefault).not.toHaveBeenCalled();
      expect(blocked.preventDefault).toHaveBeenCalledOnce();
    },
  );
});
