import { BrowserWindow } from "electron";
import { IPC_CHANNELS, type AppData, type DataError, type ImportProgress, type Contact, type GroupMap, type Server, type OnCallRow } from "@shared/ipc";
import { loggers } from "./logger";

export interface CachedData { groups: GroupMap; contacts: Contact[]; servers: Server[]; onCall: OnCallRow[] }

export class FileEmitter {
  private mainWindow: BrowserWindow;

  constructor(window: BrowserWindow) { this.mainWindow = window; }

  sendPayload(data: CachedData) {
    if (!this.mainWindow.isDestroyed()) {
      const payload: AppData = { ...data, lastUpdated: Date.now() };
      this.mainWindow.webContents.send(IPC_CHANNELS.DATA_UPDATED, payload);
    }
  }

  emitReloadStarted() { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(IPC_CHANNELS.DATA_RELOAD_STARTED); }
  emitReloadCompleted(success: boolean) { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(IPC_CHANNELS.DATA_RELOAD_COMPLETED, success); }

  emitError(error: DataError) {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.DATA_ERROR, error);
      loggers.fileManager.error(`Error: ${error.type} - ${error.message}`, error.details);
    }
  }

  emitProgress(progress: ImportProgress) { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(IPC_CHANNELS.IMPORT_PROGRESS, progress); }
}
