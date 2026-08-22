import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { getCloudStatusManager } from '../../app/appState';
import { checkNetworkRateLimit } from '../../rateLimiter';
import { CloudStatusService } from '../../services/operationalServices';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
const cloudStatusService = new CloudStatusService(getCloudStatusManager);

export function setupCloudStatusHandlers(service: CloudStatusService = cloudStatusService): void {
  ipcMain.handle(IPC_CHANNELS.GET_CLOUD_STATUS, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.GET_CLOUD_STATUS)) return service.snapshot();
    if (!checkNetworkRateLimit()) return service.snapshot();
    return service.refresh();
  });
}
