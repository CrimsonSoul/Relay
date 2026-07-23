import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { CloudStatusData, CloudStatusSnapshotRecord } from '@shared/ipc';
import { loggers } from '../../logger';
import { emptyCloudStatusProviders, fetchCloudStatusData } from './fetchCloudStatus';

const COLLECTION = 'cloud_status_snapshot';
const SNAPSHOT_KEY = 'current';
export const HEALTHY_CLOUD_STATUS_INTERVAL_MS = 5 * 60_000;
export const DEGRADED_CLOUD_STATUS_INTERVAL_MS = 60_000;

type FetchStatus = (previous?: CloudStatusData | null) => Promise<CloudStatusData>;

function emptySnapshot(): CloudStatusData {
  return { providers: emptyCloudStatusProviders(), errors: [], lastUpdated: 0 };
}

function snapshotHash(data: CloudStatusData): string {
  return createHash('sha256')
    .update(JSON.stringify({ providers: data.providers, errors: data.errors }))
    .digest('hex');
}

function isDegraded(data: CloudStatusData): boolean {
  if (data.errors.length > 0) return true;
  return Object.values(data.providers)
    .flat()
    .some((item) => item.severity === 'warning' || item.severity === 'error');
}

export class CloudStatusManager {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<CloudStatusData> | null = null;
  private snapshot: CloudStatusData = emptySnapshot();
  private contentHash = '';
  private recordId: string | null = null;
  private hydrated = false;

  constructor(
    private readonly getPocketBase: () => PocketBase | null,
    private readonly fetchStatus: FetchStatus = fetchCloudStatusData,
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.refresh();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getSnapshot(): CloudStatusData {
    return this.snapshot;
  }

  refresh(_options: { force?: boolean } = {}): Promise<CloudStatusData> {
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
      const nextHash = snapshotHash(next);
      this.snapshot = next;
      if (nextHash !== this.contentHash || isDegraded(next)) {
        await this.persistSnapshot(next, nextHash);
        this.contentHash = nextHash;
      }
      return next;
    } catch (error) {
      loggers.cloudStatus.error('Failed to refresh shared cloud status', { error });
      return this.snapshot;
    }
  }

  private async hydratePersistedSnapshot(): Promise<void> {
    if (this.hydrated) return;
    const pb = this.getPocketBase();
    if (!pb) return;
    this.hydrated = true;
    try {
      const existing = await pb
        .collection(COLLECTION)
        .getFirstListItem<CloudStatusSnapshotRecord>(`key="${SNAPSHOT_KEY}"`, {
          requestKey: null,
        });
      this.recordId = existing.id;
      this.contentHash = existing.contentHash;
      this.snapshot = {
        providers: existing.providers,
        errors: existing.errors,
        lastUpdated: existing.lastUpdated,
      };
    } catch {
      // First startup has no persisted singleton yet.
    }
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = isDegraded(this.snapshot)
      ? DEGRADED_CLOUD_STATUS_INTERVAL_MS
      : HEALTHY_CLOUD_STATUS_INTERVAL_MS;
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private async persistSnapshot(data: CloudStatusData, contentHash: string): Promise<void> {
    const pb = this.getPocketBase();
    if (!pb) return;
    const payload = {
      key: SNAPSHOT_KEY,
      providers: data.providers,
      errors: data.errors,
      lastUpdated: data.lastUpdated,
      contentHash,
    };

    if (!this.recordId) {
      try {
        const existing = await pb
          .collection(COLLECTION)
          .getFirstListItem<CloudStatusSnapshotRecord>(`key="${SNAPSHOT_KEY}"`, {
            requestKey: null,
          });
        this.recordId = existing.id;
        this.contentHash = existing.contentHash;
        if (existing.contentHash === contentHash) return;
      } catch {
        // The singleton does not exist on first server startup.
      }
    }

    if (this.recordId) {
      await pb.collection(COLLECTION).update(this.recordId, payload, { requestKey: null });
      return;
    }
    const created = await pb.collection(COLLECTION).create<CloudStatusSnapshotRecord>(payload, {
      requestKey: null,
    });
    this.recordId = created.id;
  }
}
