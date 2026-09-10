import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { CloudStatusPartition, CloudStatusProvider } from '@shared/ipc';

export const LEGACY_CLOUD_STATUS_COLLECTION = 'cloud_status_snapshot';
export const MIST_CLOUD_STATUS_COLLECTION = 'cloud_status_mist_snapshot';
export const EXTENSION_CLOUD_STATUS_COLLECTION = 'cloud_status_extension_snapshot';

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
  private client: PocketBase | null = null;
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
    const pb = this.currentClient();
    if (!pb) return empty;
    if (this.hydrated) return this.hydratedData ?? empty;

    try {
      const existing = await pb
        .collection(this.collectionName)
        .getFirstListItem<SnapshotRecord<P>>(`key="${SNAPSHOT_KEY}"`, { requestKey: null });
      this.hydrated = true;
      this.recordId = existing.id;
      this.contentHash = existing.contentHash;
      this.hydratedData = {
        providers: existing.providers,
        errors: Array.isArray(existing.errors) ? existing.errors : [],
        lastUpdated: existing.lastUpdated,
      };
      return this.hydratedData;
    } catch (error) {
      if (!isMissing(error)) throw error;
      this.hydrated = true;
      this.hydratedData = empty;
      return empty;
    }
  }

  async persist(data: CloudStatusPartition<P>, force: boolean): Promise<void> {
    const pb = this.currentClient();
    if (!pb) return;

    const contentHash = snapshotHash(data);
    if (!this.hydrated) await this.findExistingSingleton();
    if (this.recordId && contentHash === this.contentHash && !force) return;

    const payload = {
      key: SNAPSHOT_KEY,
      providers: data.providers,
      errors: data.errors,
      lastUpdated: data.lastUpdated,
      contentHash,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (this.recordId) {
          await pb
            .collection(this.collectionName)
            .update(this.recordId, payload, { requestKey: null });
        } else {
          const created = await pb
            .collection(this.collectionName)
            .create<SnapshotRecord<P>>(payload, { requestKey: null });
          this.recordId = created.id;
        }
        break;
      } catch (error) {
        this.reset();
        if (
          attempt > 0 ||
          (!isMissing(error) &&
            !(
              typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              error.status === 400
            ))
        )
          throw error;
        await this.findExistingSingleton();
      }
    }

    this.contentHash = contentHash;
    this.hydratedData = data;
  }

  reset(): void {
    this.recordId = null;
    this.contentHash = '';
    this.hydrated = false;
    this.hydratedData = null;
  }

  private currentClient(): PocketBase | null {
    const pb = this.getPocketBase();
    if (this.client !== pb) {
      this.reset();
      this.client = pb;
    }
    return pb;
  }

  private async findExistingSingleton(): Promise<void> {
    await this.hydrate();
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}
