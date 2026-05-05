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
    const weatherData = {
      current_weather: { temperature: 75 },
      hourly: { temperature_2m: [75] },
      daily: { temperature_2m_max: [80] },
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => weatherData,
    } as Response);

    await expect(handlers[IPC_CHANNELS.GET_WEATHER]({}, 30.2, -97.7)).resolves.toEqual(weatherData);
  });

  it('returns weather error for invalid coordinates', async () => {
    await expect(handlers[IPC_CHANNELS.GET_WEATHER]({}, 999, -97.7)).resolves.toBeNull();
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

  it('returns null for weather when rate limited', async () => {
    checkNetworkRateLimitMock.mockReturnValue(false);
    await expect(handlers[IPC_CHANNELS.GET_WEATHER]({}, 30.2, -97.7)).resolves.toBeNull();
  });

  it('returns weather error when API response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await handlers[IPC_CHANNELS.GET_WEATHER]({}, 30.2, -97.7);
    expect(result).toBeNull();
  });

  it('returns error when weather API response has unexpected shape', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'data' }),
    } as Response);

    const result = await handlers[IPC_CHANNELS.GET_WEATHER]({}, 30.2, -97.7);
    expect(result).toBeNull();
  });

  it('returns empty array for alerts when rate limited', async () => {
    checkNetworkRateLimitMock.mockReturnValue(false);
    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7)).resolves.toEqual([]);
  });

  it('returns empty array for alerts with invalid coordinates', async () => {
    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 999, -97.7)).resolves.toEqual([]);
  });

  it('returns empty array for alerts when API returns 404', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7)).resolves.toEqual([]);
  });

  it('returns empty array for alerts when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await expect(handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7)).resolves.toEqual([]);
  });

  it('handles alert features with missing properties gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          { id: 'alert-2', properties: undefined },
          { id: undefined, properties: { id: 'prop-id' } },
        ],
      }),
    } as Response);

    const result = await handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'alert-2',
        event: 'Unknown Event',
        severity: 'Unknown',
      }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: 'prop-id',
      }),
    );
  });

  it('handles alerts response with no features key', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await handlers[IPC_CHANNELS.GET_WEATHER_ALERTS]({}, 30.2, -97.7);
    expect(result).toEqual([]);
  });

  it('zip code lookup returns null when zippopotam API returns not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);
    // Fallback to general search
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ name: 'Place', latitude: 30, longitude: -97 }] }),
    } as Response);

    const result = await handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, '00000');
    expect(result).toEqual({ results: [{ name: 'Place', latitude: 30, longitude: -97 }] });
  });

  it('zip code lookup returns null when places array is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ places: [] }),
    } as Response);
    // Falls back to general search
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, '99999');
    expect(result).toEqual({ results: [] });
  });

  it('search location returns error on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network down'));

    const result = await handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, 'Denver');
    expect(result).toEqual({ error: 'Location search unavailable' });
  });

  it('search location does not retry city-only when no comma in query', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await handlers[IPC_CHANNELS.SEARCH_LOCATION]({}, 'Denver');
    // Only one fetch call — no comma fallback
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ results: [] });
  });
});
