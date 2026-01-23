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

interface IpApiComResponse {
  lat?: number;
  lon?: number;
  city?: string;
  regionName?: string;
  country?: string;
  timezone?: string;
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
        loggers.ipc.info('Location found via ipapi.co', { city: data.city });
        return {
          lat: data.latitude,
          lon: data.longitude,
          city: data.city,
          region: data.region,
          country: data.country_name,
          timezone: data.timezone
        };
      }
      loggers.ipc.warn('ipapi.co returned non-OK status', { status: res.status });
    } catch (err) {
      loggers.ipc.warn('ipapi.co failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Provider 2: ip-api.com (HTTPS with HTTP fallback)
    for (const protocol of ['https', 'http']) {
      try {
        if (protocol === 'http') {
          loggers.ipc.info('Falling back to HTTP for ip-api.com (corporate network compatibility)');
        }
        loggers.ipc.debug(`Trying ip-api.com (${protocol})...`);
        const res = await fetch(`${protocol}://ip-api.com/json/`, {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json() as IpApiComResponse;
          loggers.ipc.info(`Location found via ip-api.com (${protocol})`, { city: data.city });
          return {
            lat: data.lat,
            lon: data.lon,
            city: data.city,
            region: data.regionName,
            country: data.country,
            timezone: data.timezone
          };
        }
        loggers.ipc.warn(`ip-api.com (${protocol}) returned non-OK status`, { status: res.status });
      } catch (err) {
        loggers.ipc.warn(`ip-api.com (${protocol}) failed`, { error: err instanceof Error ? err.message : String(err) });
      }
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
          loggers.ipc.info('Location found via ipwho.is', { city: data.city });
          return {
            lat: data.latitude,
            lon: data.longitude,
            city: data.city,
            region: data.region,
            country: data.country,
            timezone: data.timezone?.id
          };
        }
      }
    } catch (err) {
      loggers.ipc.error('All location providers failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  });

  ipcMain.on(IPC_CHANNELS.RADAR_DATA, (_event, payload) => {
    const validatedPayload = validateIpcDataSafe(RadarSnapshotSchema, payload, 'RADAR_DATA');
    if (!validatedPayload) return;

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.RADAR_DATA, validatedPayload);
    }
  });
}
