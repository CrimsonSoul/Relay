import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';

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
      console.error('[Weather] Fetch error:', err);
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
      console.error('[Weather] Search error:', err);
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

      const pointData: any = await pointRes.json();
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

      const alertData: any = await alertRes.json();
      const features = alertData.features || [];

      // Map to our WeatherAlert type
      return features.map((f: any) => ({
        id: f.properties?.id || f.id,
        event: f.properties?.event || 'Unknown Event',
        headline: f.properties?.headline || '',
        description: f.properties?.description || '',
        severity: f.properties?.severity || 'Unknown',
        urgency: f.properties?.urgency || 'Unknown',
        certainty: f.properties?.certainty || 'Unknown',
        effective: f.properties?.effective || '',
        expires: f.properties?.expires || '',
        senderName: f.properties?.senderName || 'National Weather Service',
        areaDesc: f.properties?.areaDesc || ''
      }));
    } catch (err: any) {
      console.error('[Weather] Alerts fetch error:', err);
      return []; // Return empty array on error to not break the UI
    }
  });
}
