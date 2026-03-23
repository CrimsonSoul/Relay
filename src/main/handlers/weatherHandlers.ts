/* global RequestInit */
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { SearchQuerySchema } from '@shared/ipcValidation';
import { loggers } from '../logger';
import { ErrorCategory } from '@shared/logging';
import { checkNetworkRateLimit } from '../rateLimiter';
import { isValidCoordinate } from '../utils/validation';
import { truncateError } from './ipcHelpers';

interface ZipCodeResult {
  name: string;
  lat: number;
  lon: number;
  admin1: string;
  country_code: string;
}

/** Look up a US 5-digit zip code via zippopotam.us. Returns null on miss/error. */
async function lookupZipCode(zip: string): Promise<{ results: ZipCodeResult[] } | null> {
  try {
    const zipRes = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!zipRes.ok) return null;
    const zipData = (await zipRes.json()) as {
      'post code': string;
      country: string;
      places: Array<{
        'place name': string;
        longitude: string;
        state: string;
        'state abbreviation': string;
        latitude: string;
      }>;
    };
    const place = zipData.places?.[0];
    if (!place) return null;
    return {
      results: [
        {
          name: place['place name'],
          lat: Number.parseFloat(place.latitude),
          lon: Number.parseFloat(place.longitude),
          admin1: place.state,
          country_code: 'US',
        },
      ],
    };
  } catch (error_) {
    loggers.weather.warn('Zip code search failed, falling back to general search', {
      query: zip,
      error: truncateError(error_),
    });
    return null;
  }
}

// NWS API Response Types (for type safety)
interface NWSAlertProperties {
  id?: string;
  event?: string;
  headline?: string;
  description?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  effective?: string;
  expires?: string;
  senderName?: string;
  areaDesc?: string;
}

interface NWSAlertFeature {
  id?: string;
  properties?: NWSAlertProperties;
}

interface NWSAlertsResponse {
  features?: NWSAlertFeature[];
}

export function setupWeatherHandlers() {
  // Weather Handlers
  ipcMain.handle(IPC_CHANNELS.GET_WEATHER, async (_event, lat, lon) => {
    if (!checkNetworkRateLimit()) return null;
    try {
      if (!isValidCoordinate(lat, lon)) {
        loggers.weather.warn('Invalid coordinates for weather fetch', { lat, lon });
        throw new Error('Invalid coordinates');
      }

      const nLat = Number(lat);
      const nLon = Number(lon);

      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${nLat}&longitude=${nLon}&hourly=temperature_2m,weathercode,precipitation_probability&daily=weathercode,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=16&timezone=auto`,
        { cache: 'no-store' } as RequestInit,
      );
      if (!res.ok) throw new Error('Failed to fetch weather data');
      const data = await res.json();

      // Basic shape validation: ensure the response has expected top-level keys
      if (
        !data ||
        typeof data !== 'object' ||
        !('current_weather' in data) ||
        !('hourly' in data) ||
        !('daily' in data)
      ) {
        loggers.weather.warn('Weather API returned unexpected shape', {
          keys: data ? Object.keys(data) : [],
        });
        return { error: 'Weather data has unexpected format' };
      }

      return data;
    } catch (err: unknown) {
      const message = truncateError(err);
      loggers.weather.error('Failed to fetch weather data', {
        error: message,
        category: ErrorCategory.NETWORK,
        lat,
        lon,
      });
      return { error: 'Weather service unavailable' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SEARCH_LOCATION, async (_event, query: string) => {
    if (!checkNetworkRateLimit()) return { results: [] };
    try {
      const validated = SearchQuerySchema.safeParse(query);
      if (!validated.success) {
        loggers.weather.warn('Invalid search query', {
          error: validated.error.message,
          queryLength: typeof query === 'string' ? query.length : 0,
        });
        return { results: [] };
      }
      const trimmedQuery = validated.data.trim();

      // Handle Zip Code (US 5-digit)
      if (/^\d{5}$/.test(trimmedQuery)) {
        const zipResult = await lookupZipCode(trimmedQuery);
        if (zipResult) return zipResult;
      }

      // General Search
      const fetchResults = async (q: string) => {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
        );
        if (!res.ok) throw new Error('Geocoding failed');
        return await res.json();
      };

      let data = (await fetchResults(trimmedQuery)) as {
        results?: Array<{ name: string; latitude: number; longitude: number }>;
      };

      // Fallback for "City, State" format if no results
      if ((!data?.results || data?.results?.length === 0) && trimmedQuery.includes(',')) {
        const cityPart = trimmedQuery.split(',')[0]?.trim();
        if (cityPart) {
          loggers.weather.info('Retrying search with city part only', {
            original: trimmedQuery,
            cityPart,
          });
          data = (await fetchResults(cityPart)) as {
            results?: Array<{ name: string; latitude: number; longitude: number }>;
          };
        }
      }

      return data;
    } catch (err: unknown) {
      const message = truncateError(err);
      loggers.weather.error('Location search failed', {
        error: message,
        category: ErrorCategory.NETWORK,
      });
      return { error: 'Location search unavailable' };
    }
  });

  // Weather Alerts (NWS API - US only)
  ipcMain.handle(IPC_CHANNELS.GET_WEATHER_ALERTS, async (_event, lat, lon) => {
    if (!checkNetworkRateLimit()) return [];
    try {
      if (!isValidCoordinate(lat, lon)) {
        loggers.weather.warn('Invalid coordinates for alerts fetch', { lat, lon });
        return [];
      }

      const nLat = Number(lat);
      const nLon = Number(lon);

      // NWS requires a point lookup first (optional check, but NWS alerts endpoint also takes point)
      // Point lookup is good for verifying it's in a supported area
      const alertRes = await fetch(
        `https://api.weather.gov/alerts/active?point=${nLat.toFixed(4)},${nLon.toFixed(4)}`,
        { headers: { 'User-Agent': 'Relay-Weather-App', Accept: 'application/geo+json' } },
      );

      if (!alertRes.ok) {
        if (alertRes.status === 404) return [];
        throw new Error('Failed to fetch weather alerts');
      }

      const alertData = (await alertRes.json()) as NWSAlertsResponse;
      const features = alertData.features || [];

      // Map to our WeatherAlert type
      return features.map((f: NWSAlertFeature) => {
        const props = f.properties;

        // Helper to capitalize first letter and handle missing values
        const normalize = (val: string | undefined) => {
          if (!val) return 'Unknown';
          return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
        };

        return {
          id: props?.id || f.id,
          event: props?.event || 'Unknown Event',
          headline: props?.headline || '',
          description: props?.description || '',
          severity: normalize(props?.severity),
          urgency: normalize(props?.urgency),
          certainty: normalize(props?.certainty),
          effective: props?.effective || '',
          expires: props?.expires || '',
          senderName: props?.senderName || 'National Weather Service',
          areaDesc: props?.areaDesc || '',
        };
      });
    } catch (err: unknown) {
      const message = truncateError(err);
      loggers.weather.error('Failed to fetch weather alerts', {
        error: message,
        category: ErrorCategory.NETWORK,
        lat,
        lon,
      });
      return []; // Return empty array on error to not break the UI
    }
  });
}
