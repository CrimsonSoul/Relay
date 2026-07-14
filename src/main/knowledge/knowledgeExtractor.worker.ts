import { parentPort } from 'node:worker_threads';
import { extractKnowledgePdf } from './knowledgeExtractor';

type ExtractRequest = { id: number; data: ArrayBuffer };

const SAFE_ERRORS = new Set(['encrypted-pdf', 'page-limit', 'invalid-pdf']);

parentPort?.on('message', async (request: ExtractRequest) => {
  try {
    const result = await extractKnowledgePdf(new Uint8Array(request.data));
    parentPort?.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error && SAFE_ERRORS.has(error.message)
        ? error.message
        : 'extraction-failed';
    parentPort?.postMessage({ id: request.id, ok: false, error: message });
  }
});
