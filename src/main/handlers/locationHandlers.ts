import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { loggers } from '../logger';

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
    try {
      const res = await fetch('https://ipapi.co/json/', {
        headers: { 'User-Agent': 'Relay-App' }
      });
      if (res.ok) {
        const data = await res.json() as IpApiCoResponse;
        return {
          lat: data.latitude,
          lon: data.longitude,
          city: data.city,
          region: data.region,
          country: data.country_name,
          timezone: data.timezone
        };
      }
    } catch (err) {
      loggers.ipc.warn('Location primary provider failed, trying fallback', { error: err });
    }

    try {
      const res = await fetch('http://ip-api.com/json/');
      if (res.ok) {
        const data = await res.json() as IpApiComResponse;
        return {
          lat: data.lat,
          lon: data.lon,
          city: data.city,
          region: data.regionName,
          country: data.country,
          timezone: data.timezone
        };
      }
    } catch (err) {
      loggers.ipc.error('All location providers failed', { error: err });
    }
    return null;
  });

  ipcMain.on(IPC_CHANNELS.RADAR_DATA, (_event, payload) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.RADAR_DATA, payload);
    }
  });
}
