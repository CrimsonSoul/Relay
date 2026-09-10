import type PocketBase from 'pocketbase';
import type {
  CloudStatusData,
  CloudStatusItem,
  CloudStatusProvider,
  ExtensionCloudStatusProvider,
  LegacyCloudStatusProvider,
  MistCloudStatusProvider,
} from '@shared/ipc';
import {
  emptyCloudStatusProviders,
  emptyExtensionCloudStatusProviders,
  emptyLegacyCloudStatusProviders,
  emptyMistCloudStatusProviders,
  mergeCloudStatusData,
  splitCloudStatusData,
} from '@shared/cloudStatus';
import { loggers } from '../../logger';
import { fetchCloudStatusData } from './fetchCloudStatus';
import {
  CloudStatusSnapshotStore,
  EXTENSION_CLOUD_STATUS_COLLECTION,
  LEGACY_CLOUD_STATUS_COLLECTION,
  MIST_CLOUD_STATUS_COLLECTION,
} from './CloudStatusSnapshotStore';

export const HEALTHY_CLOUD_STATUS_INTERVAL_MS = 5 * 60_000;
export const DEGRADED_CLOUD_STATUS_INTERVAL_MS = 60_000;
const CURRENT_CLOUD_STATUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type FetchStatus = (previous?: CloudStatusData | null) => Promise<CloudStatusData>;

function emptySnapshot(): CloudStatusData {
  return { providers: emptyCloudStatusProviders(), errors: [], lastUpdated: 0 };
}

function isDegraded(data: {
  errors: readonly unknown[];
  providers: Partial<Record<CloudStatusProvider, CloudStatusItem[]>>;
}): boolean {
  if (data.errors.length > 0) return true;
  const oldestCurrentIssue = Date.now() - CURRENT_CLOUD_STATUS_WINDOW_MS;
  return Object.values(data.providers).some((items) =>
    items?.some((item) => {
      const publishedAt = Date.parse(item.pubDate);
      return (
        (item.severity === 'warning' || item.severity === 'error') &&
        Number.isFinite(publishedAt) &&
        publishedAt >= oldestCurrentIssue
      );
    }),
  );
}

export class CloudStatusManager {
  private active = false;
  private pausedForRestore = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<CloudStatusData> | null = null;
  private snapshot: CloudStatusData = emptySnapshot();
  private hydrated = false;
  private hydratedClient: PocketBase | null = null;
  private readonly legacyStore: CloudStatusSnapshotStore<LegacyCloudStatusProvider>;
  private readonly mistStore: CloudStatusSnapshotStore<MistCloudStatusProvider>;
  private readonly extensionStore: CloudStatusSnapshotStore<ExtensionCloudStatusProvider>;

  constructor(
    private readonly getPocketBase: () => PocketBase | null,
    private readonly fetchStatus: FetchStatus = fetchCloudStatusData,
  ) {
    this.legacyStore = new CloudStatusSnapshotStore(
      getPocketBase,
      LEGACY_CLOUD_STATUS_COLLECTION,
      emptyLegacyCloudStatusProviders,
    );
    this.mistStore = new CloudStatusSnapshotStore(
      getPocketBase,
      MIST_CLOUD_STATUS_COLLECTION,
      emptyMistCloudStatusProviders,
    );
    this.extensionStore = new CloudStatusSnapshotStore(
      getPocketBase,
      EXTENSION_CLOUD_STATUS_COLLECTION,
      emptyExtensionCloudStatusProviders,
    );
  }

  start(): void {
    this.pausedForRestore = false;
    if (this.active) return;
    this.active = true;
    void this.refresh();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async stopForRestore(): Promise<void> {
    this.pausedForRestore = true;
    this.stop();
    await this.inFlight?.catch(() => undefined);
    this.hydrated = false;
    this.legacyStore.reset();
    this.mistStore.reset();
    this.extensionStore.reset();
  }

  getSnapshot(): CloudStatusData {
    return this.snapshot;
  }

  refresh(_options: { force?: boolean } = {}): Promise<CloudStatusData> {
    if (this.pausedForRestore)
      return Promise.reject(new Error('Cloud status refresh is paused for backup restore.'));
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
      if (this.active) this.scheduleNext();
    });
    return this.inFlight;
  }

  private async performRefresh(): Promise<CloudStatusData> {
    try {
      await this.hydratePersistedSnapshot();
      const next = await this.fetchStatus(this.snapshot);
      const { legacy, mist, extension } = splitCloudStatusData(next);
      const writes = await Promise.allSettled([
        this.legacyStore.persist(legacy, isDegraded(legacy)),
        this.mistStore.persist(mist, isDegraded(mist)),
        this.extensionStore.persist(extension, isDegraded(extension)),
      ]);
      const failedWrite = writes.find((result) => result.status === 'rejected');
      if (failedWrite) throw failedWrite.reason;
      this.snapshot = next;
      return next;
    } catch (error) {
      loggers.cloudStatus.error('Failed to refresh shared cloud status', { error });
      return this.snapshot;
    }
  }

  private async hydratePersistedSnapshot(): Promise<void> {
    const pb = this.getPocketBase();
    if (!pb) return;
    if (this.hydrated && this.hydratedClient === pb) return;
    const current = splitCloudStatusData(this.snapshot);
    const [legacy, mist, extension] = await Promise.all([
      this.legacyStore.hydrate(current.legacy),
      this.mistStore.hydrate(current.mist),
      this.extensionStore.hydrate(current.extension),
    ]);
    this.snapshot = mergeCloudStatusData(legacy, mist, extension);
    this.hydrated = true;
    this.hydratedClient = pb;
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = isDegraded(this.snapshot)
      ? DEGRADED_CLOUD_STATUS_INTERVAL_MS
      : HEALTHY_CLOUD_STATUS_INTERVAL_MS;
    this.timer = setTimeout(() => void this.refresh(), delay);
  }
}
