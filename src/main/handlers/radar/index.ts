import { ipcMain } from 'electron';
import { IPC_CHANNELS, type RadarSnapshot } from '@shared/ipc';
import { getRadarManager as getRadarManagerFromState } from '../../app/appState';
import { checkNetworkRateLimit } from '../../rateLimiter';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { broadcastToAllWindows } from '../../utils/broadcastToAllWindows';
import { emptyRadarSnapshot } from './fetchRadar';
import type { RadarManager } from './RadarManager';
import { openRadarSignIn } from './radarSignInWindow';

type GetManager = () => RadarManager | null;

export function setupRadarHandlers(
  getRadarManager: GetManager = getRadarManagerFromState,
  openSignIn: typeof openRadarSignIn = openRadarSignIn,
): () => void {
  const snapshot = (): RadarSnapshot => getRadarManager()?.getSnapshot() ?? emptyRadarSnapshot();

  ipcMain.handle(IPC_CHANNELS.RADAR_GET_SNAPSHOT, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.RADAR_GET_SNAPSHOT)) return snapshot();
    return snapshot();
  });

  ipcMain.handle(IPC_CHANNELS.RADAR_REFRESH, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.RADAR_REFRESH)) return snapshot();
    if (!checkNetworkRateLimit()) return snapshot();
    return (await getRadarManager()?.refresh()) ?? snapshot();
  });

  ipcMain.handle(IPC_CHANNELS.RADAR_OPEN_SIGN_IN, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.RADAR_OPEN_SIGN_IN)) return false;
    // Re-poll as soon as the user finishes, rather than waiting out the minute.
    return openSignIn(() => void getRadarManager()?.refresh());
  });

  const unsubscribe = getRadarManager()?.subscribe((next) => {
    broadcastToAllWindows(IPC_CHANNELS.RADAR_SNAPSHOT_CHANGED, next);
  });

  return () => unsubscribe?.();
}
