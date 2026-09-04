import type { BridgeAPI } from '@shared/ipc';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  isKnowledgePdfDownloadFileName,
  sanitizeKnowledgePdfDownloadFileName,
  normalizeKnowledgeUploadQueueView,
  normalizeKnowledgeUploadSelectionResult,
  type KnowledgeCoverResult,
  type KnowledgePdfDownloadResult,
  type KnowledgePdfResult,
  type KnowledgeUploadQueueView,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import { normalizeKnowledgeSearchResponse } from '@shared/knowledgeSearch';
import {
  RELAY_WEB_API_PREFIX,
  WebKnowledgeIndexStatusSchema,
  WebKnowledgeUploadStagingBatchSchema,
} from '@shared/webApi';
import { validatedRequest, type WebBridgeContext, type WebBridgeRequest } from './context';

export type KnowledgeWebApi = Pick<
  BridgeAPI,
  | 'getKnowledgePdf'
  | 'downloadKnowledgePdf'
  | 'getKnowledgeCover'
  | 'getKnowledgeIndexStatus'
  | 'searchKnowledge'
  | 'cancelKnowledgeSearch'
  | 'onKnowledgeIndexStatusChanged'
  | 'openKnowledgeWebLink'
  | 'selectAndQueueKnowledgePdfs'
  | 'getKnowledgeUploadQueue'
  | 'pauseKnowledgeUploadBatch'
  | 'resumeKnowledgeUploadBatch'
  | 'retryKnowledgeUpload'
  | 'reselectKnowledgeUploadSource'
  | 'cancelKnowledgeUpload'
  | 'cancelKnowledgeUploadBatch'
  | 'onKnowledgeUploadQueueChanged'
>;

/** A fresh view each call: the queue's `items` array must not be shared. */
function emptyUploadQueue(): KnowledgeUploadQueueView {
  return {
    restartRecovery: false,
    activeBatchId: null,
    totalBytes: 0,
    acknowledgedBytes: 0,
    items: [],
  };
}

type KnowledgeBinaryKind = 'pdf' | 'cover';
type KnowledgeBinaryResult = KnowledgePdfResult | KnowledgeCoverResult;

function knowledgeDownloadError(kind: KnowledgeBinaryKind, value: unknown): KnowledgeBinaryResult {
  const safe = String(value);
  if (kind === 'pdf') {
    const errors: Array<Extract<KnowledgePdfResult, { ok: false }>['error']> = [
      'not-found',
      'not-available-offline',
      'invalid-document',
      'download-failed',
      'checksum-mismatch',
    ];
    return {
      ok: false,
      error: errors.includes(safe as (typeof errors)[number])
        ? (safe as (typeof errors)[number])
        : 'download-failed',
    };
  }
  const errors: Array<Extract<KnowledgeCoverResult, { ok: false }>['error']> = [
    'not-found',
    'not-available-offline',
    'invalid-document',
    'download-failed',
    'render-failed',
  ];
  return {
    ok: false,
    error: errors.includes(safe as (typeof errors)[number])
      ? (safe as (typeof errors)[number])
      : 'download-failed',
  };
}

async function knowledgeFailure(
  kind: KnowledgeBinaryKind,
  response: Response,
): Promise<KnowledgeBinaryResult> {
  try {
    const error = (await response.json()) as { error?: unknown };
    return knowledgeDownloadError(kind, error.error);
  } catch {
    return knowledgeDownloadError(kind, null);
  }
}

function knowledgeSuccess(
  kind: KnowledgeBinaryKind,
  data: ArrayBuffer,
  checksum: string,
  source: string | null,
): KnowledgeBinaryResult {
  if (kind === 'pdf') {
    return ['server', 'cache', 'download'].includes(source ?? '')
      ? {
          ok: true,
          data,
          checksum,
          source: source as Extract<KnowledgePdfResult, { ok: true }>['source'],
        }
      : { ok: false, error: 'download-failed' };
  }
  return ['server', 'cache', 'generated', 'download'].includes(source ?? '')
    ? {
        ok: true,
        data,
        checksum,
        source: source as Extract<KnowledgeCoverResult, { ok: true }>['source'],
      }
    : { ok: false, error: 'download-failed' };
}

async function knowledgeBinary(
  kind: KnowledgeBinaryKind,
  input: { documentId: string; checksum: string },
  fetcher: typeof fetch,
): Promise<KnowledgeBinaryResult> {
  const parameters = new URLSearchParams({
    documentId: input.documentId,
    checksum: input.checksum,
  });
  const response = await fetcher(`${RELAY_WEB_API_PREFIX}/knowledge/${kind}?${parameters}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    method: 'GET',
    redirect: 'error',
    headers: { Accept: kind === 'pdf' ? 'application/pdf' : 'image/png' },
  });
  if (!response.ok) return knowledgeFailure(kind, response);
  const checksum = response.headers.get('x-relay-checksum');
  const source = response.headers.get('x-relay-source');
  if (checksum !== input.checksum) return { ok: false, error: 'download-failed' };
  const data = await response.arrayBuffer();
  return knowledgeSuccess(kind, data, checksum, source);
}

function validSelectedPdfs(files: readonly File[], replacementDocumentId?: string): boolean {
  if (files.length < 1 || files.length > KNOWLEDGE_UPLOAD_MAX_FILES) return false;
  if (replacementDocumentId && files.length !== 1) return false;
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    const name = file.name.toLocaleLowerCase('en');
    total += file.size;
    if (
      !name.endsWith('.pdf') ||
      file.size < 5 ||
      file.size > KNOWLEDGE_MAX_PDF_BYTES ||
      names.has(name) ||
      total > KNOWLEDGE_MAX_PDF_BYTES * KNOWLEDGE_UPLOAD_MAX_FILES
    ) {
      return false;
    }
    names.add(name);
  }
  return true;
}

// A maximum batch is ~1 GB of transfer. Treating a 429 as fatal discarded the whole thing, so a
// throttled chunk waits out the server's Retry-After instead and only fails after the budget is
// genuinely exhausted.
const MAX_CHUNK_RETRIES = 5;
const DEFAULT_CHUNK_RETRY_MS = 1_000;
const MAX_CHUNK_RETRY_MS = 30_000;

function chunkRetryDelayMs(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get('retry-after'));
  const advertised = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
  return Math.min(MAX_CHUNK_RETRY_MS, Math.max(advertised, DEFAULT_CHUNK_RETRY_MS * 2 ** attempt));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function uploadChunk(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await fetcher(url, init);
  for (let attempt = 0; response.status === 429 && attempt < MAX_CHUNK_RETRIES; attempt += 1) {
    await delay(chunkRetryDelayMs(response, attempt));
    response = await fetcher(url, init);
  }
  return response;
}

async function uploadKnowledgePdfs(
  files: readonly File[],
  request: WebBridgeRequest,
  fetcher: typeof fetch,
  csrfToken: string,
  replacementDocumentId?: string,
  reselectUploadId?: string,
): Promise<KnowledgeUploadSelectionResult> {
  if (!validSelectedPdfs(files, replacementDocumentId)) {
    return { ok: false, error: 'invalid-file' };
  }
  try {
    const batch = WebKnowledgeUploadStagingBatchSchema.parse(
      await request('/knowledge/upload/begin', {
        method: 'POST',
        body: {
          files: files.map((file) => ({ name: file.name, size: file.size })),
          ...(replacementDocumentId ? { replacementDocumentId } : {}),
          ...(reselectUploadId ? { reselectUploadId } : {}),
        },
      }),
    );
    const batchId = batch.batchId;
    if (
      batch.files.length !== files.length ||
      batch.files.some(
        (staged, index) => staged.name !== files[index]?.name || staged.size !== files[index]?.size,
      )
    ) {
      throw new Error('invalid-staging-response');
    }
    for (const [fileIndex, file] of files.entries()) {
      const staged = batch.files[fileIndex]!;
      for (let offset = 0; offset < file.size; offset += KNOWLEDGE_UPLOAD_CHUNK_BYTES) {
        const body = file.slice(offset, Math.min(file.size, offset + KNOWLEDGE_UPLOAD_CHUNK_BYTES));
        const parameters = new URLSearchParams({ fileId: staged.id, offset: String(offset) });
        const response = await uploadChunk(
          fetcher,
          `${RELAY_WEB_API_PREFIX}/knowledge/upload/chunk?${parameters}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            method: 'POST',
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/octet-stream',
              'X-Relay-CSRF': csrfToken,
            },
            body,
          },
        );
        if (!response.ok) throw new Error('chunk-rejected');
      }
    }
    const result = normalizeKnowledgeUploadSelectionResult(
      await request('/knowledge/upload/commit', { method: 'POST', body: { batchId } }),
    );
    return result ?? { ok: false, error: 'upload-failed' };
  } catch {
    // Retain declarations in the server session so a refreshed tab can reselect the PDFs.
    // Restarting sends every byte again; no unverified partial file is reused.
    return { ok: false, error: 'upload-failed' };
  }
}

export function createKnowledgeWebApi({
  session,
  fetcher,
  request,
  subscribe,
  actions,
}: WebBridgeContext): KnowledgeWebApi {
  return {
    getKnowledgePdf: async (input) => {
      const result = await knowledgeBinary('pdf', input, fetcher);
      return result as KnowledgePdfResult;
    },
    downloadKnowledgePdf: async (input): Promise<KnowledgePdfDownloadResult> => {
      if (!isKnowledgePdfDownloadFileName(input.fileName)) {
        return { ok: false, error: 'invalid-document' };
      }
      const result = (await knowledgeBinary('pdf', input, fetcher)) as KnowledgePdfResult;
      if (!result.ok) return result;
      return actions.downloadBytes(
        result.data,
        sanitizeKnowledgePdfDownloadFileName(input.fileName),
        'application/pdf',
      )
        ? { ok: true }
        : { ok: false, error: 'save-failed' };
    },
    getKnowledgeCover: async (input) => {
      const result = await knowledgeBinary('cover', input, fetcher);
      return result as KnowledgeCoverResult;
    },
    getKnowledgeIndexStatus: () =>
      validatedRequest(
        request,
        '/knowledge/index-status',
        { method: 'GET' },
        WebKnowledgeIndexStatusSchema,
      ),
    searchKnowledge: async (input) =>
      normalizeKnowledgeSearchResponse(
        await request('/knowledge/search', { method: 'POST', body: input }),
      ) ?? { ok: false, requestId: input.requestId, error: 'unavailable' },
    cancelKnowledgeSearch: (requestId) => {
      void request('/knowledge/search/cancel', { method: 'POST', body: { requestId } }).catch(
        () => undefined,
      );
    },
    onKnowledgeIndexStatusChanged: (callback) =>
      subscribe('knowledge-index-status-changed', callback),
    openKnowledgeWebLink: async (url) =>
      actions.openExternal(url) ? { ok: true } : { ok: false, error: 'invalid-url' },
    selectAndQueueKnowledgePdfs: async (replacementDocumentId) => {
      const files = await actions.selectPdfs(Boolean(replacementDocumentId));
      return files.length
        ? uploadKnowledgePdfs(files, request, fetcher, session.csrfToken, replacementDocumentId)
        : { ok: false, error: 'cancelled' };
    },
    getKnowledgeUploadQueue: async () =>
      normalizeKnowledgeUploadQueueView(
        await request('/knowledge/upload/queue', { method: 'GET' }),
      ) ?? emptyUploadQueue(),
    pauseKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/pause-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    resumeKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/resume-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    retryKnowledgeUpload: (id) =>
      request<boolean>('/knowledge/upload/retry-upload', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    reselectKnowledgeUploadSource: async (id) => {
      // Open the picker before awaiting network I/O to retain browser user activation.
      const files = await actions.selectPdfs(false);
      if (!files.length) return false;
      try {
        const pending = WebKnowledgeUploadStagingBatchSchema.nullable().parse(
          await request('/knowledge/upload/pending', { method: 'GET' }),
        );
        if (!pending) {
          const queue = normalizeKnowledgeUploadQueueView(
            await request('/knowledge/upload/queue', { method: 'GET' }),
          );
          const item = queue?.items.find(
            (candidate) => candidate.id === id || candidate.uploadId === id,
          );
          if (
            item?.state !== 'source-required' ||
            files.length !== 1 ||
            files[0]!.name !== item.fileName ||
            files[0]!.size !== item.byteSize
          )
            return false;
          return (
            await uploadKnowledgePdfs(files, request, fetcher, session.csrfToken, undefined, id)
          ).ok;
        }
        if (
          pending.batchId !== id ||
          pending.files.length !== files.length ||
          !validSelectedPdfs(files, pending.replacementDocumentId)
        )
          return false;
        const ordered = pending.files.map((item) =>
          files.find((file) => file.name === item.name && file.size === item.size),
        );
        if (ordered.some((file) => !file)) return false;
        await request('/knowledge/upload/abort', { method: 'POST', body: { batchId: id } });
        return (
          await uploadKnowledgePdfs(
            ordered as File[],
            request,
            fetcher,
            session.csrfToken,
            pending.replacementDocumentId,
            pending.reselectUploadId,
          )
        ).ok;
      } catch {
        return false;
      }
    },
    cancelKnowledgeUpload: (id) =>
      request<boolean>('/knowledge/upload/cancel-upload', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    cancelKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/cancel-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    onKnowledgeUploadQueueChanged: (callback) =>
      subscribe('knowledge-upload-queue-changed', callback),
  } satisfies KnowledgeWebApi;
}
