import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { RadarSnapshotSchema, validateIpcDataSafe } from '../../shared/ipcValidation';
import { loggers } from '../logger';
import { checkNetworkRateLimit } from '../rateLimiter';

interface IpApiCoResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country_name?: string;
  timezone?: string;
}

interface IpInfoIoResponse {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string; // "lat,lon" format
  timezone?: string;
}

/** Runtime validation for location API responses */
function validateLocationResponse(data: { lat?: unknown; lon?: unknown; city?: unknown; region?: unknown; country?: unknown; timezone?: unknown }): boolean {
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function setupLocationHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC_CHANNELS.GET_IP_LOCATION, async () => {
    if (!checkNetworkRateLimit()) return null;
    loggers.ipc.info('Received GET_IP_LOCATION request');
    
    // Provider 1: ipapi.co (HTTPS)
    try {
      loggers.ipc.debug('Trying ipapi.co...');
      const res = await fetch('https://ipapi.co/json/', {
        headers: { 'User-Agent': 'Relay-App' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json() as IpApiCoResponse;
        const result = {
          lat: data.latitude,
          lon: data.longitude,
          city: data.city,
          region: data.region,
          country: data.country_name,
          timezone: data.timezone
        };
        if (validateLocationResponse(result)) {
          loggers.ipc.info('Location found via ipapi.co', { city: data.city });
          return result;
        }
        loggers.ipc.warn('ipapi.co returned invalid location data');
      } else {
        loggers.ipc.warn('ipapi.co returned non-OK status', { status: res.status });
      }
    } catch (err) {
      loggers.ipc.warn('ipapi.co failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Provider 2: ipinfo.io (HTTPS only — replaced insecure ip-api.com)
    try {
      loggers.ipc.debug('Trying ipinfo.io...');
      const res = await fetch('https://ipinfo.io/json', {
        headers: { 'User-Agent': 'Relay-App' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json() as IpInfoIoResponse;
        const [lat, lon] = (data.loc || '').split(',').map(Number);
        const result = {
          lat,
          lon,
          city: data.city,
          region: data.region,
          country: data.country,
          timezone: data.timezone
        };
        if (validateLocationResponse(result)) {
          loggers.ipc.info('Location found via ipinfo.io', { city: data.city });
          return result;
        }
        loggers.ipc.warn('ipinfo.io returned invalid location data');
      } else {
        loggers.ipc.warn('ipinfo.io returned non-OK status', { status: res.status });
      }
    } catch (err) {
      loggers.ipc.warn('ipinfo.io failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Provider 3: ipwho.is (HTTPS)
    try {
      loggers.ipc.debug('Trying ipwho.is...');
      const res = await fetch('https://ipwho.is/', {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json() as {
          success: boolean;
          latitude?: number;
          longitude?: number;
          city?: string;
          region?: string;
          country?: string;
          timezone?: { id?: string };
        };
        if (data.success) {
          const result = {
            lat: data.latitude,
            lon: data.longitude,
            city: data.city,
            region: data.region,
            country: data.country,
            timezone: data.timezone?.id
          };
          if (validateLocationResponse(result)) {
            loggers.ipc.info('Location found via ipwho.is', { city: data.city });
            return result;
          }
          loggers.ipc.warn('ipwho.is returned invalid location data');
        }
      }
    } catch (err) {
      loggers.ipc.error('All location providers failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  });

  ipcMain.on(IPC_CHANNELS.RADAR_DATA, (_event, payload) => {
    const validatedPayload = validateIpcDataSafe(RadarSnapshotSchema, payload, 'RADAR_DATA', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedPayload) return;

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.RADAR_DATA, validatedPayload);
    }
  });
}
