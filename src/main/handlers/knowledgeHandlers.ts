import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { KnowledgePdfRequestSchema } from '@shared/ipcValidation';
import type { KnowledgeIndexStatus, KnowledgePdfResult } from '@shared/knowledge';
import type { KnowledgeBaseManager } from '../knowledge/KnowledgeBaseManager';
import type { KnowledgePdfService } from '../knowledge/KnowledgePdfService';
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
}
