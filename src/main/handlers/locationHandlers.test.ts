import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupLocationHandlers } from './locationHandlers';

const checkNetworkRateLimitMock = vi.fn(() => true);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../rateLimiter', () => ({
  checkNetworkRateLimit: () => checkNetworkRateLimitMock(),
}));

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('locationHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};

  const send = vi.fn();
  const getMainWindow = vi.fn(() => ({ isDestroyed: () => false, webContents: { send } }));

  beforeEach(() => {
    vi.clearAllMocks();
    checkNetworkRateLimitMock.mockReturnValue(true);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => Promise<unknown>;
    });
    vi.mocked(ipcMain.on).mockImplementation((channel, handler) => {
      eventHandlers[channel] = handler as (...args: unknown[]) => void;
      return ipcMain;
    });
    vi.stubGlobal('fetch', vi.fn());

    setupLocationHandlers(getMainWindow);
  });

  it('returns ipapi location when first provider succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: 30.2672, longitude: -97.7431, city: 'Austin', region: 'TX' }),
    } as Response);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toEqual({
      lat: 30.2672,
      lon: -97.7431,
      city: 'Austin',
      region: 'TX',
      country: undefined,
      timezone: undefined,
    });
  });

  it('falls back across providers and eventually returns null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, latitude: 999, longitude: 999 }),
      } as Response);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toBeNull();
  });

  it('returns null when network rate limit blocks requests', async () => {
    checkNetworkRateLimitMock.mockReturnValue(false);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards valid radar payloads to main window', () => {
    eventHandlers[IPC_CHANNELS.RADAR_DATA](
      {},
      {
        counters: { ok: 2, pending: 0, internalError: 0 },
        statusText: 'Connected',
        statusVariant: 'success',
        lastUpdated: Date.now(),
      },
    );

    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.RADAR_DATA,
      expect.objectContaining({ statusText: 'Connected' }),
    );
  });

  it('drops invalid radar payloads', () => {
    eventHandlers[IPC_CHANNELS.RADAR_DATA]({}, { statusVariant: 'wat', lastUpdated: 'bad' });

    expect(send).not.toHaveBeenCalled();
  });

  it('returns ipinfo.io location when ipapi.co fails and ipinfo.io succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          city: 'Denver',
          region: 'CO',
          country: 'US',
          loc: '39.7392,-104.9903',
          timezone: 'America/Denver',
        }),
      } as Response);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toEqual({
      lat: 39.7392,
      lon: -104.9903,
      city: 'Denver',
      region: 'CO',
      country: 'US',
      timezone: 'America/Denver',
    });
  });

  it('warns when ipapi.co returns invalid coordinates', async () => {
    const { loggers } = await import('../logger');
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ latitude: 999, longitude: 999 }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toBeNull();
    expect(loggers.ipc.warn).toHaveBeenCalledWith('ipapi.co returned invalid location data');
  });

  it('returns ipwho.is location when earlier providers fail', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          latitude: 41.85,
          longitude: -87.65,
          city: 'Chicago',
          region: 'IL',
          country: 'US',
          timezone: { id: 'America/Chicago' },
        }),
      } as Response);

    await expect(handlers[IPC_CHANNELS.GET_IP_LOCATION]({})).resolves.toEqual({
      lat: 41.85,
      lon: -87.65,
      city: 'Chicago',
      region: 'IL',
      country: 'US',
      timezone: 'America/Chicago',
    });
  });
});
