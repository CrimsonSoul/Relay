import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../../logger';
import { BrandAssetService } from '../../services/operationalServices';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { pickImageFile } from './imageFilePicker';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;

function registerBrandAssetHandlers(
  brandAssets: BrandAssetService | null,
  kind: 'company' | 'footer',
  dialogTitle: string,
  channels: { save: string; get: string; remove: string },
): void {
  ipcMain.handle(channels.save, async (event) => {
    if (!assertTrustedIpcSender(event, channels.save)) {
      return { success: false, error: 'Untrusted sender' };
    }
    if (!brandAssets) return { success: false, error: 'Data root not available' };
    try {
      const picked = await pickImageFile({
        title: dialogTitle,
        maxBytes: MAX_LOGO_SIZE,
        sizeError: 'Image must be under 2MB',
      });
      if (!picked.success) return picked;

      return await brandAssets.savePng(kind, picked.buffer);
    } catch (err) {
      loggers.ipc.warn(`${dialogTitle} save failed`, { error: getErrorMessage(err) });
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
    }
  });

  ipcMain.handle(channels.get, async (event) => {
    if (!assertTrustedIpcSender(event, channels.get)) return null;
    return (await brandAssets?.get(kind)) ?? null;
  });

  ipcMain.handle(channels.remove, async (event) => {
    if (!assertTrustedIpcSender(event, channels.remove)) {
      return { success: false, error: 'Untrusted sender' };
    }
    if (!brandAssets) return { success: false, error: 'Data root not available' };
    return await brandAssets.remove(kind);
  });
}

export function registerCompanyBrandAssetHandlers(brandAssets: BrandAssetService | null): void {
  registerBrandAssetHandlers(brandAssets, 'company', 'Select Company Logo', {
    save: IPC_CHANNELS.SAVE_COMPANY_LOGO,
    get: IPC_CHANNELS.GET_COMPANY_LOGO,
    remove: IPC_CHANNELS.REMOVE_COMPANY_LOGO,
  });
}

export function registerFooterBrandAssetHandlers(brandAssets: BrandAssetService | null): void {
  registerBrandAssetHandlers(brandAssets, 'footer', 'Select Footer Logo', {
    save: IPC_CHANNELS.SAVE_FOOTER_LOGO,
    get: IPC_CHANNELS.GET_FOOTER_LOGO,
    remove: IPC_CHANNELS.REMOVE_FOOTER_LOGO,
  });
}
