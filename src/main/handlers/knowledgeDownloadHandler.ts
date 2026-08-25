import { randomUUID } from 'node:crypto';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dialog, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { KnowledgePdfDownloadRequestSchema } from '@shared/ipcValidation';
import {
  sanitizeKnowledgePdfDownloadFileName,
  type KnowledgePdfDownloadResult,
} from '@shared/knowledge';
import { shouldSuppressDesktopSideEffects } from '../app/e2eSafety';
import type { KnowledgePdfService } from '../knowledge/KnowledgePdfService';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';

type GetKnowledgePdfService = () => KnowledgePdfService | null;

async function writePdfAtomically(filePath: string, data: ArrayBuffer): Promise<void> {
  const temporaryPath = join(dirname(filePath), `.relay-download-${randomUUID()}.tmp`);
  let handle: FileHandle | null = null;
  let temporaryCreated = false;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    temporaryCreated = true;
    await handle.writeFile(new Uint8Array(data));
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (temporaryCreated) await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function downloadKnowledgePdf(
  event: IpcMainInvokeEvent,
  request: unknown,
  getService: GetKnowledgePdfService,
): Promise<KnowledgePdfDownloadResult> {
  if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)) {
    return { ok: false, error: 'invalid-document' };
  }
  const parsed = KnowledgePdfDownloadRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, error: 'invalid-document' };
  if (!rateLimiters.fsOperations.tryConsume().allowed) {
    return { ok: false, error: 'rate-limited' };
  }
  const service = getService();
  if (!service) return { ok: false, error: 'not-found' };
  if (shouldSuppressDesktopSideEffects()) return { ok: false, error: 'cancelled' };

  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: sanitizeKnowledgePdfDownloadFileName(parsed.data.fileName),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, error: 'cancelled' };

    const result = await service.getPdf({
      documentId: parsed.data.documentId,
      checksum: parsed.data.checksum,
    });
    if (!result.ok) return result;
    await writePdfAtomically(filePath, result.data);
    return { ok: true };
  } catch {
    loggers.ipc.warn('Knowledge PDF save failed');
    return { ok: false, error: 'save-failed' };
  }
}
