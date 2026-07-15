import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { KnowledgePdfRequestSchema } from '@shared/ipcValidation';
import type {
  KnowledgeIndexStatus,
  KnowledgeOpenWebLinkResult,
  KnowledgePdfResult,
} from '@shared/knowledge';
import type { KnowledgeBaseManager } from '../knowledge/KnowledgeBaseManager';
import type { KnowledgePdfService } from '../knowledge/KnowledgePdfService';
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

export function setupKnowledgeHandlers(
  getService: () => KnowledgePdfService | null,
  getManager: () => KnowledgeBaseManager | null,
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
      return getManager()?.getStatus() ?? EMPTY_STATUS;
    },
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
