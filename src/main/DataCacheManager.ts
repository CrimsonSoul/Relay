import { FileEmitter, CachedData } from "./FileEmitter";
import { type DataError, type ImportProgress } from "@shared/ipc";

/**
 * DataCacheManager - Manages the in-memory cache of application data
 * and coordinates broadcasting updates to the renderer windows.
 */
export class DataCacheManager {
  private emitter: FileEmitter;
  private cachedData: CachedData = {
    groups: [],
    contacts: [],
    servers: [],
    onCall: [],
    teamLayout: {}
  };

  constructor() {
    this.emitter = new FileEmitter();
  }

  public getCache(): Readonly<CachedData> {
    return this.cachedData;
  }

  public updateCache(data: Partial<CachedData>): void {
    this.cachedData = { ...this.cachedData, ...data };
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

  public emitProgress(progress: ImportProgress): void {
    this.emitter.emitProgress(progress);
  }
}
