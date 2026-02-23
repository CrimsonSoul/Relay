import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupWeatherHandlers } from './weatherHandlers';

const checkNetworkRateLimitMock = vi.fn(() => true);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../rateLimiter', () => ({
  checkNetworkRateLimit: () => checkNetworkRateLimitMock(),
}));

vi.mock('../logger', () => ({
  loggers: {
    weather: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('weatherHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    checkNetworkRateLimitMock.mockReturnValue(true);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => Promise<unknown>;
    });
    vi.stubGlobal('fetch', vi.fn());

    setupWeatherHandlers();
  });

  it('returns weather payload for valid coordinates', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 75 } }),
    } as Response);

    await expect(handlers[IPC_CHANNELS.GET_WEATHER]({}, 30.2, -97.7)).resolves.toEqual({
      current_weather: { temperature: 75 },
    });
  });

  it('returns weather error for invalid coordinates', async () => {
    await expect(handlers[IPC_CHANNELS.GET_WEATHER]({}, 999, -97.7)).resolves.toEqual({
      error: 'Weather service unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns empty search results when rate-limited or invalid', async () => {
    checkNetworkRateLimitMock.mockReturnValue(false);
    await expect(handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, 'Austin')).resolves.toEqual({
      results: [],
    });

    checkNetworkRateLimitMock.mockReturnValue(true);
    await expect(handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, '<bad>')).resolves.toEqual({
      results: [],
    });
  });

  it('handles zip code search path', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          { 'place name': 'Austin', latitude: '30.26', longitude: '-97.74', state: 'Texas' },
        ],
      }),
    } as Response);

    await expect(handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, '78701')).resolves.toEqual({
      results: [
        {
          name: 'Austin',
          lat: 30.26,
          lon: -97.74,
          admin1: 'Texas',
          country_code: 'US',
        },
      ],
    });
  });

  it('falls back to city-only general search after comma query miss', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ name: 'Austin', latitude: 30.2, longitude: -97.7 }] }),
      } as Response);

    await expect(handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, 'Austin, TX')).resolves.toEqual({
      results: [{ name: 'Austin', latitude: 30.2, longitude: -97.7 }],
    });
  });

  it('maps weather alerts and handles failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'alert-1',
            properties: {
              event: 'TORNADO WARNING',
              severity: 'EXTREME',
              urgency: 'IMMEDIATE',
              certainty: 'OBSERVED',
            },
          },
        ],
      }),
    } as Response);

    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7)).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-1',
        event: 'TORNADO WARNING',
        severity: 'Extreme',
        urgency: 'Immediate',
        certainty: 'Observed',
      }),
    ]);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7)).resolves.toEqual([]);
  });
});
