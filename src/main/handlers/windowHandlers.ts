import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { BrandAssetService } from '../services/operationalServices';
import {
  registerAlertPlaySoundHandler,
  registerAlertSelectReminderSoundHandler,
  registerOptimizeAlertImageHandler,
  registerSaveAlertImageHandler,
  registerSelectAlertBodyImageHandler,
} from './window/alertMediaHandlers';
import {
  registerCompanyBrandAssetHandlers,
  registerFooterBrandAssetHandlers,
} from './window/brandAssetHandlers';
import { registerClipboardWriteHandler } from './window/clipboardHandlers';
import {
  registerDragStartedHandler,
  registerDragStoppedHandler,
  registerOnCallAlertDismissedHandler,
} from './window/crossWindowHandlers';
import {
  registerAlertDraftSaveAndOpenHandler,
  registerIcsSaveAndOpenHandler,
} from './window/documentHandoffHandlers';
import { registerOpenExternalHandler } from './window/externalLinkHandlers';
import {
  registerWindowCloseHandler,
  registerWindowIsMaximizedHandler,
  registerWindowMaximizeHandler,
  registerWindowMinimizeHandler,
} from './window/windowControlHandlers';

export function setupWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  getDataRoot?: () => Promise<string>,
): void {
  const brandAssets = getDataRoot ? new BrandAssetService(getDataRoot) : null;

  registerOpenExternalHandler();
  registerIcsSaveAndOpenHandler();
  registerAlertDraftSaveAndOpenHandler();
  registerAlertPlaySoundHandler();
  registerAlertSelectReminderSoundHandler();
  registerSelectAlertBodyImageHandler();
  registerWindowMinimizeHandler();
  registerDragStartedHandler();
  registerDragStoppedHandler();
  registerOnCallAlertDismissedHandler();
  registerClipboardWriteHandler();
  registerOptimizeAlertImageHandler();
  registerSaveAlertImageHandler();
  registerCompanyBrandAssetHandlers(brandAssets);
  registerFooterBrandAssetHandlers(brandAssets);
  registerWindowMaximizeHandler();
  registerWindowCloseHandler();
  registerWindowIsMaximizedHandler();
}

export function setupWindowListeners(window: BrowserWindow): void {
  window.on('maximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, true);
  });
  window.on('unmaximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, false);
  });
}
