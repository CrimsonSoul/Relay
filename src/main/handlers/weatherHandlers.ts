import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { SearchQuerySchema } from '@shared/ipcValidation';
import { loggers } from '../logger';
import { ErrorCategory } from '@shared/logging';
import { checkNetworkRateLimit } from '../rateLimiter';
import { getErrorMessage } from '@shared/types';

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
      const nLat = Number(lat);
      const nLon = Number(lon);

      if (isNaN(nLat) || isNaN(nLon) || nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) {
        loggers.weather.warn('Invalid coordinates for weather fetch', { lat, lon });
        throw new Error('Invalid coordinates');
      }

      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${nLat}&longitude=${nLon}&hourly=temperature_2m,weathercode,precipitation_probability&daily=weathercode,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=16&timezone=auto`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to fetch weather data');
      return await res.json();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
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
        loggers.weather.warn('Invalid search query', { error: validated.error.message, query });
        return { results: [] };
      }
      const trimmedQuery = validated.data.trim();

      // Handle Zip Code (US 5-digit)
      if (/^\d{5}$/.test(trimmedQuery)) {
        try {
          const zipRes = await fetch(`https://api.zippopotam.us/us/${trimmedQuery}`);
          if (zipRes.ok) {
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
            if (zipData.places?.[0]) {
              const place = zipData.places[0];
              return {
                results: [
                  {
                    name: place['place name'],
                    lat: parseFloat(place.latitude),
                    lon: parseFloat(place.longitude),
                    admin1: place.state,
                    country_code: 'US',
                  },
                ],
              };
            }
          }
        } catch (_err) {
          loggers.weather.warn('Zip code search failed, falling back to general search', {
            query: trimmedQuery,
          });
        }
      }

      // General Search
      const fetchResults = async (q: string) => {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
        );
        if (!res.ok) throw new Error('Geocoding failed');
        return await res.json();
      };

      let data = await fetchResults(trimmedQuery);

      // Fallback for "City, State" format if no results
      if ((!data.results || data.results.length === 0) && trimmedQuery.includes(',')) {
        const cityPart = trimmedQuery.split(',')[0].trim();
        if (cityPart) {
          loggers.weather.info('Retrying search with city part only', {
            original: trimmedQuery,
            cityPart,
          });
          data = await fetchResults(cityPart);
        }
      }

      return data;
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      loggers.weather.error('Location search failed', {
        error: message,
        category: ErrorCategory.NETWORK,
        query,
      });
      return { error: 'Location search unavailable' };
    }
  });

  // Weather Alerts (NWS API - US only)
  ipcMain.handle(IPC_CHANNELS.GET_WEATHER_ALERTS, async (_event, lat, lon) => {
    if (!checkNetworkRateLimit()) return [];
    try {
      const nLat = Number(lat);
      const nLon = Number(lon);

      if (isNaN(nLat) || isNaN(nLon) || nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) {
        loggers.weather.warn('Invalid coordinates for alerts fetch', { lat, lon });
        return [];
      }

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
      const message = getErrorMessage(err);
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
