import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { CloudStatusPartition, CloudStatusProvider } from '@shared/ipc';

export const LEGACY_CLOUD_STATUS_COLLECTION = 'cloud_status_snapshot';
export const MIST_CLOUD_STATUS_COLLECTION = 'cloud_status_mist_snapshot';

const SNAPSHOT_KEY = 'current';

type SnapshotRecord<P extends CloudStatusProvider> = CloudStatusPartition<P> & {
  id: string;
  key: 'current';
  contentHash: string;
};

function snapshotHash<P extends CloudStatusProvider>(data: CloudStatusPartition<P>): string {
  return createHash('sha256')
    .update(JSON.stringify({ providers: data.providers, errors: data.errors }))
    .digest('hex');
}

export class CloudStatusSnapshotStore<P extends CloudStatusProvider> {
  private recordId: string | null = null;
  private contentHash = '';
  private hydrated = false;
  private hydratedData: CloudStatusPartition<P> | null = null;

  constructor(
    private readonly getPocketBase: () => PocketBase | null,
    private readonly collectionName: string,
    private readonly emptyProviders: () => CloudStatusPartition<P>['providers'],
  ) {}

  async hydrate(fallback?: CloudStatusPartition<P>): Promise<CloudStatusPartition<P>> {
    const empty = fallback ?? { providers: this.emptyProviders(), errors: [], lastUpdated: 0 };
    if (this.hydrated) return this.hydratedData ?? empty;

    const pb = this.getPocketBase();
    if (!pb) return empty;
    this.hydrated = true;

    try {
      const existing = await pb
        .collection(this.collectionName)
        .getFirstListItem<SnapshotRecord<P>>(`key="${SNAPSHOT_KEY}"`, { requestKey: null });
      this.recordId = existing.id;
      this.contentHash = existing.contentHash;
      this.hydratedData = {
        providers: existing.providers,
        errors: Array.isArray(existing.errors) ? existing.errors : [],
        lastUpdated: existing.lastUpdated,
      };
      return this.hydratedData;
    } catch {
      this.hydratedData = empty;
      return empty;
    }
  }

  async persist(data: CloudStatusPartition<P>, force: boolean): Promise<void> {
    const pb = this.getPocketBase();
    if (!pb) return;

    const contentHash = snapshotHash(data);
    if (!this.hydrated) await this.findExistingSingleton(pb);
    if (this.recordId && contentHash === this.contentHash && !force) return;

    const payload = {
      key: SNAPSHOT_KEY,
      providers: data.providers,
      errors: data.errors,
      lastUpdated: data.lastUpdated,
      contentHash,
    };

    if (this.recordId) {
      await pb.collection(this.collectionName).update(this.recordId, payload, { requestKey: null });
    } else {
      const created = await pb
        .collection(this.collectionName)
        .create<SnapshotRecord<P>>(payload, { requestKey: null });
      this.recordId = created.id;
    }

    this.contentHash = contentHash;
    this.hydratedData = data;
  }

  private async findExistingSingleton(pb: PocketBase): Promise<void> {
    this.hydrated = true;
    try {
      const existing = await pb
        .collection(this.collectionName)
        .getFirstListItem<SnapshotRecord<P>>(`key="${SNAPSHOT_KEY}"`, { requestKey: null });
      this.recordId = existing.id;
      this.contentHash = existing.contentHash;
    } catch {
      // The collection or singleton is absent on first startup.
    }
  }
}
