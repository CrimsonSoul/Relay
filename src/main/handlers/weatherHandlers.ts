import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { loggers, ErrorCategory } from '../logger';

// NWS API Response Types (for type safety)
interface NWSPointProperties {
  county?: string;
  forecastZone?: string;
}

interface NWSPointResponse {
  properties?: NWSPointProperties;
}

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
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weathercode,precipitation_probability&daily=weathercode,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=16`
      );
      if (!res.ok) throw new Error('Failed to fetch weather data');
      return await res.json();
    } catch (err: any) {
      loggers.weather.error('Failed to fetch weather data', {
        error: err.message,
        stack: err.stack,
        category: ErrorCategory.NETWORK,
        lat,
        lon
      });
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SEARCH_LOCATION, async (_event, query) => {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
      );
      if (!res.ok) throw new Error('Geocoding failed');
      return await res.json();
    } catch (err: any) {
      loggers.weather.error('Location search failed', {
        error: err.message,
        stack: err.stack,
        category: ErrorCategory.NETWORK,
        query
      });
      throw err;
    }
  });

  // Weather Alerts (NWS API - US only)
  ipcMain.handle(IPC_CHANNELS.GET_WEATHER_ALERTS, async (_event, lat: number, lon: number) => {
    try {
      // NWS requires a point lookup first to get the zone/county for alerts
      const pointRes = await fetch(
        `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
        { headers: { 'User-Agent': 'Relay-Weather-App', 'Accept': 'application/geo+json' } }
      );

      if (!pointRes.ok) {
        // Location might be outside US - return empty alerts
        if (pointRes.status === 404) {
          return [];
        }
        throw new Error('Failed to get location info from NWS');
      }

      const pointData = await pointRes.json() as NWSPointResponse;
      const countyZone = pointData.properties?.county;
      const forecastZone = pointData.properties?.forecastZone;

      // Fetch alerts for the area
      const alertRes = await fetch(
        `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
        { headers: { 'User-Agent': 'Relay-Weather-App', 'Accept': 'application/geo+json' } }
      );

      if (!alertRes.ok) {
        throw new Error('Failed to fetch weather alerts');
      }

      const alertData = await alertRes.json() as NWSAlertsResponse;
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
          areaDesc: props?.areaDesc || ''
        };
      });
    } catch (err: any) {
      loggers.weather.error('Failed to fetch weather alerts', {
        error: err.message,
        stack: err.stack,
        category: ErrorCategory.NETWORK,
        lat,
        lon
      });
      return []; // Return empty array on error to not break the UI
    }
  });
}
