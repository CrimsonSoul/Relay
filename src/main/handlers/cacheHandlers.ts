import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';

export function setupCacheHandlers(getCache: () => OfflineCache | null): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_READ, (_event, collection: string) => {
    const cache = getCache();
    if (!cache) return [];
    return cache.readCollection(collection);
  });

  ipcMain.handle(
    IPC_CHANNELS.CACHE_WRITE,
    (_event, collection: string, action: string, record: Record<string, unknown>) => {
      const cache = getCache();
      if (!cache) return;
      cache.updateRecord(collection, action as 'create' | 'update' | 'delete', record);
    },
  );
}
