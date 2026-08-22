import { parentPort } from 'node:worker_threads';
import { extractKnowledgePdf } from './knowledgeExtractor';
import { extractKnowledgeSearchPages } from './knowledgeSearchExtraction';

type WorkerRequest =
  | { id: number; kind: 'metadata'; data: ArrayBuffer }
  | { id: number; kind: 'search'; data: ArrayBuffer };

const SAFE_ERRORS = new Set(['encrypted-pdf', 'page-limit', 'invalid-pdf']);

parentPort?.on('message', async (request: WorkerRequest) => {
  try {
    const data = new Uint8Array(request.data);
    if (request.kind === 'metadata') {
      const result = await extractKnowledgePdf(data);
      parentPort?.postMessage({ id: request.id, kind: request.kind, ok: true, result });
    } else {
      const result = await extractKnowledgeSearchPages(data);
      parentPort?.postMessage({ id: request.id, kind: request.kind, ok: true, result });
    }
  } catch (error) {
    const message =
      error instanceof Error && SAFE_ERRORS.has(error.message)
        ? error.message
        : 'extraction-failed';
    parentPort?.postMessage({ id: request.id, kind: request.kind, ok: false, error: message });
  }
});
