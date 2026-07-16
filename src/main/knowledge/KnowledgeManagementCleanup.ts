import type PocketBase from 'pocketbase';
import { KNOWLEDGE_AUDIT_EVENTS_COLLECTION, KNOWLEDGE_UPLOADS_COLLECTION } from '@shared/knowledge';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

type ExpiredUpload = {
  id: string;
  requestId: string;
  fileName: string;
  operatorId: string;
  operatorName: string;
  state: string;
};

type KnowledgeManagementCleanupOptions = {
  pb: PocketBase;
  now?: () => number;
};

export class KnowledgeManagementCleanup {
  private readonly pb: PocketBase;
  private readonly now: () => number;

  constructor(options: KnowledgeManagementCleanupOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
  }

  async run(): Promise<{ expiredUploads: number; expiredAuditEvents: number }> {
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
    for (const upload of uploads) {
      if (upload.state !== 'published') await this.recordExpiredUpload(upload);
      await collection.delete(upload.id, { requestKey: null });
    }
    return uploads.length;
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

  private async recordExpiredUpload(upload: ExpiredUpload): Promise<void> {
    await this.pb.collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).create(
      {
        requestId: upload.requestId,
        action: 'upload-expired',
        targetId: '',
        fileName: upload.fileName,
        title: '',
        category: '',
        operatorId: upload.operatorId,
        operatorName: upload.operatorName,
        occurredAt: new Date(this.now()).toISOString(),
        details: { previousState: upload.state },
      },
      { requestKey: null },
    );
  }
}
