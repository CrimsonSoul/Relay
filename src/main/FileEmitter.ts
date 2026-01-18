import { BrowserWindow } from "electron";
import { IPC_CHANNELS, type AppData, type DataError, type ImportProgress, type Contact, type BridgeGroup, type Server, type OnCallRow } from "@shared/ipc";
import { loggers } from "./logger";

export interface CachedData { groups: BridgeGroup[]; contacts: Contact[]; servers: Server[]; onCall: OnCallRow[] }

export class FileEmitter {
  constructor() { }

  sendPayload(data: CachedData) {
    const payload: AppData = { ...data, lastUpdated: Date.now() };
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.DATA_UPDATED, payload);
      }
    });
  }

  emitReloadStarted() {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.DATA_RELOAD_STARTED);
      }
    });
  }

  emitReloadCompleted(success: boolean) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.DATA_RELOAD_COMPLETED, success);
      }
    });
  }

  emitError(error: DataError) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.DATA_ERROR, error);
      }
    });
    loggers.fileManager.error(`Error: ${error.type} - ${error.message}`, error.details);
  }

  emitProgress(progress: ImportProgress) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.IMPORT_PROGRESS, progress);
      }
    });
  }
}
