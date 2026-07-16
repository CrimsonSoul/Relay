import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { KnowledgePdfRequestSchema, KnowledgeUploadControlIdSchema } from '@shared/ipcValidation';
import type {
  KnowledgeIndexStatus,
  KnowledgeOpenWebLinkResult,
  KnowledgePdfResult,
  KnowledgeUploadQueueView,
} from '@shared/knowledge';
import type { KnowledgeIndexStatusService } from '../knowledge/KnowledgeIndexStatusService';
import type { KnowledgePdfService } from '../knowledge/KnowledgePdfService';
import type { KnowledgeUploadService } from '../knowledge/KnowledgeUploadService';
import { normalizeKnowledgeWebUrl } from '../knowledge/knowledgeWebLinks';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const EMPTY_STATUS: KnowledgeIndexStatus = {
  state: 'idle',
  documentCount: 0,
  categoryCount: 0,
  lastIndexedAt: null,
};

const EMPTY_UPLOAD_QUEUE: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

export function setupKnowledgeHandlers(
  getService: () => KnowledgePdfService | null,
  getIndexStatusService: () => KnowledgeIndexStatusService | null,
  getUploadService: () => KnowledgeUploadService | null = () => null,
): void {
  ipcMain.handle(
    IPC_CHANNELS.KNOWLEDGE_GET_PDF,
    async (event, request: unknown): Promise<KnowledgePdfResult> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_GET_PDF)) {
        return { ok: false, error: 'invalid-document' };
      }
      const parsed = KnowledgePdfRequestSchema.safeParse(request);
      if (!parsed.success) return { ok: false, error: 'invalid-document' };
      const service = getService();
      return service ? service.getPdf(parsed.data) : { ok: false, error: 'not-found' };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS,
    async (event): Promise<KnowledgeIndexStatus> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS)) {
        return EMPTY_STATUS;
      }
      return (await getIndexStatusService()?.getStatus()) ?? EMPTY_STATUS;
    },
  );

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE)) {
      return { ok: false, error: 'unauthorized' } as const;
    }
    if (!rateLimiters.fsOperations.tryConsume().allowed) {
      return { ok: false, error: 'upload-failed' } as const;
    }
    const uploadService = getUploadService();
    return uploadService
      ? uploadService.selectAndQueue()
      : ({ ok: false, error: 'offline' } as const);
  });

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_GET, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_GET)) {
      return EMPTY_UPLOAD_QUEUE;
    }
    return getUploadService()?.snapshot() ?? EMPTY_UPLOAD_QUEUE;
  });

  const registerUploadControl = (
    channel: string,
    control: (service: KnowledgeUploadService, id: string) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, value: unknown): Promise<boolean> => {
      if (!assertTrustedIpcSender(event, channel)) return false;
      const parsed = KnowledgeUploadControlIdSchema.safeParse(value);
      const service = getUploadService();
      if (!parsed.success || !service) return false;
      await control(service, parsed.data);
      return true;
    });
  };

  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_PAUSE, (service, id) =>
    service.pauseBatch(id),
  );
  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_RESUME, (service, id) =>
    service.resumeBatch(id),
  );
  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY, (service, id) =>
    service.retryUpload(id),
  );
  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT, (service, id) =>
    service.reselectSource(id),
  );
  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_FILE_CANCEL, (service, id) =>
    service.cancelUpload(id),
  );
  registerUploadControl(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_CANCEL, (service, id) =>
    service.cancelBatch(id),
  );

  ipcMain.handle(
    IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK,
    async (event, value: unknown): Promise<KnowledgeOpenWebLinkResult> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK)) {
        return { ok: false, error: 'invalid-url' };
      }
      if (!rateLimiters.fsOperations.tryConsume().allowed) {
        return { ok: false, error: 'rate-limited' };
      }
      const url = normalizeKnowledgeWebUrl(value);
      if (!url) {
        loggers.security.warn('Blocked unsupported Knowledge web link');
        return { ok: false, error: 'invalid-url' };
      }
      try {
        await shell.openExternal(url);
        return { ok: true };
      } catch {
        loggers.ipc.warn('Knowledge web link open failed');
        return { ok: false, error: 'open-failed' };
      }
    },
  );
}
