import { BrowserWindow } from 'electron';
import {
  IPC_CHANNELS,
  type AppData,
  type DataError,
  type ImportProgress,
  type Contact,
  type BridgeGroup,
  type Server,
  type OnCallRow,
  type TeamLayout,
} from '@shared/ipc';
import { loggers } from './logger';

export interface CachedData {
  groups: BridgeGroup[];
  contacts: Contact[];
  servers: Server[];
  onCall: OnCallRow[];
  teamLayout?: TeamLayout;
}

export class FileEmitter {
  /** Broadcast a message to all open windows */
  private broadcastToAll(channel: string, ...args: unknown[]) {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    });
  }

  sendPayload(data: CachedData) {
    const payload: AppData = { ...data, lastUpdated: Date.now() };
    this.broadcastToAll(IPC_CHANNELS.DATA_UPDATED, payload);
  }

  emitReloadStarted() {
    this.broadcastToAll(IPC_CHANNELS.DATA_RELOAD_STARTED);
  }

  emitReloadCompleted(success: boolean) {
    this.broadcastToAll(IPC_CHANNELS.DATA_RELOAD_COMPLETED, success);
  }

  emitError(error: DataError) {
    this.broadcastToAll(IPC_CHANNELS.DATA_ERROR, error);
    loggers.fileManager.error(`Error: ${error.type} - ${error.message}`, error.details);
  }

  emitProgress(progress: ImportProgress) {
    this.broadcastToAll(IPC_CHANNELS.IMPORT_PROGRESS, progress);
  }
}
