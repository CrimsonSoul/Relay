import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_UPLOADS_COLLECTION,
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
} from '@shared/knowledge';
import type { KnowledgeUploadCoordinator } from './KnowledgeUploadCoordinator';
import { loggers } from '../logger';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

type ExpiredUpload = {
  id: string;
  requestId: string;
  fileName: string;
  accountId: string;
  actorDisplayName?: string;
  operatorId?: string;
  operatorName?: string;
  state: string;
  expiresAt: string;
  revision: number;
};

type KnowledgeManagementCleanupOptions = {
  pb: PocketBase;
  now?: () => number;
  withStagingMutation?: KnowledgeUploadCoordinator['withStagingMutation'];
};

export class KnowledgeManagementCleanup {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly withStagingMutation: KnowledgeUploadCoordinator['withStagingMutation'];

  constructor(options: KnowledgeManagementCleanupOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.withStagingMutation = options.withStagingMutation ?? ((_key, action) => action());
  }

  async run(): Promise<{ expiredUploads: number; expiredAuditEvents: number }> {
    await this.expireBatches();
    const expiredUploads = await this.expireUploads();
    const expiredAuditEvents = await this.expireAuditEvents();
    return { expiredUploads, expiredAuditEvents };
  }

  private async expireUploads(): Promise<number> {
    const cutoff = new Date(this.now()).toISOString();
    const collection = this.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION);
    const uploads = await collection.getFullList<ExpiredUpload>({
      filter: `expiresAt < "${cutoff}"`,
      requestKey: null,
    });
    let expired = 0;
    for (const upload of uploads) {
      try {
        if (
          await this.withStagingMutation(`upload:${upload.id}`, () => this.expireUpload(upload.id))
        )
          expired += 1;
      } catch (error) {
        loggers.retention.warn('Knowledge upload expiry will be retried', {
          uploadId: upload.id,
          error,
        });
      }
    }
    return expired;
  }

  private async expireBatches(): Promise<void> {
    const collection = this.pb.collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION);
    const batches = await collection.getFullList<{ id: string }>({
      filter: `expiresAt < "${new Date(this.now()).toISOString()}"`,
      requestKey: null,
    });
    for (const batch of batches) {
      try {
        await this.withStagingMutation(`batch:${batch.id}`, async () => {
          const current = await collection.getOne<{
            id: string;
            state: string;
            revision: number;
            expiresAt: string;
          }>(batch.id, { requestKey: null });
          if (current.state !== 'active' || Date.parse(current.expiresAt) >= this.now()) return;
          await collection.update(
            current.id,
            { state: 'expired', revision: current.revision + 1 },
            { requestKey: null },
          );
        });
      } catch (error) {
        loggers.retention.warn('Knowledge batch expiry will be retried', {
          batchId: batch.id,
          error,
        });
      }
    }
  }

  private async expireUpload(uploadId: string): Promise<boolean> {
    const collection = this.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION);
    const current = await collection.getOne<ExpiredUpload>(uploadId, { requestKey: null });
    if (
      !Number.isFinite(Date.parse(current.expiresAt)) ||
      Date.parse(current.expiresAt) >= this.now()
    )
      return false;
    // Cancel before enumerating chunks so no producer can add another chunk to this manifest.
    if (!['published', 'cancelled'].includes(current.state)) {
      await collection.update(
        current.id,
        { state: 'cancelled', revision: current.revision + 1 },
        { requestKey: null },
      );
    }
    const chunks = await this.pb
      .collection(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION)
      .getFullList<{ id: string }>({
        filter: this.pb.filter('uploadId = {:uploadId}', { uploadId }),
        requestKey: null,
      });
    const batch = this.pb.createBatch();
    for (const chunk of chunks)
      batch.collection(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION).delete(chunk.id);
    if (current.state !== 'published')
      batch.collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).create(this.expiredUploadAudit(current));
    batch.collection(KNOWLEDGE_UPLOADS_COLLECTION).delete(current.id);
    const results = await batch.send({ requestKey: null });
    const expected = chunks.length + (current.state === 'published' ? 1 : 2);
    if (results.length !== expected || results.some(({ status }) => status < 200 || status >= 300))
      throw new Error('Knowledge upload expiry did not commit.');
    return true;
  }

  private async expireAuditEvents(): Promise<number> {
    const cutoff = new Date(this.now() - AUDIT_RETENTION_MS).toISOString();
    const collection = this.pb.collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION);
    const events = await collection.getFullList<{ id: string }>({
      filter: `occurredAt < "${cutoff}"`,
      requestKey: null,
    });
    for (const event of events) {
      await collection.delete(event.id, { requestKey: null });
    }
    return events.length;
  }

  private expiredUploadAudit(upload: ExpiredUpload): Record<string, unknown> {
    const actorDisplayName = upload.actorDisplayName || upload.operatorName || '';
    return {
      requestId: upload.requestId,
      action: 'upload-expired',
      targetId: '',
      fileName: upload.fileName,
      title: '',
      category: '',
      accountId: upload.accountId,
      actorDisplayName,
      operatorId: '',
      operatorName: '',
      occurredAt: new Date(this.now()).toISOString(),
      details: { previousState: upload.state },
    };
  }
}
