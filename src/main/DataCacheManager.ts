import { FileEmitter, CachedData } from './FileEmitter';
import { type DataError } from '@shared/ipc';

/**
 * Deep-freeze an object and all nested objects/arrays to prevent
 * accidental mutation of shared cache references.
 */
function deepFreeze<T>(obj: T): T {
  if (typeof obj !== 'object' || !obj) return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * DataCacheManager - Manages the in-memory cache of application data
 * and coordinates broadcasting updates to the renderer windows.
 */
export class DataCacheManager {
  private readonly emitter: FileEmitter;
  private cachedData: CachedData = {
    groups: [],
    contacts: [],
    servers: [],
    onCall: [],
    teamLayout: {},
  };

  constructor() {
    this.emitter = new FileEmitter();
  }

  public getCache(): Readonly<CachedData> {
    return this.cachedData;
  }

  public updateCache(data: Partial<CachedData>): void {
    this.cachedData = deepFreeze({ ...this.cachedData, ...data });
  }

  public broadcast(): void {
    this.emitter.sendPayload(this.cachedData);
  }

  public emitReloadStarted(): void {
    this.emitter.emitReloadStarted();
  }

  public emitReloadCompleted(success: boolean): void {
    this.emitter.emitReloadCompleted(success);
  }

  public emitError(error: DataError): void {
    this.emitter.emitError(error);
  }
}
