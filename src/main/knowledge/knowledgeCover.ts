import { createCanvas } from '@napi-rs/canvas';
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { KNOWLEDGE_MAX_COVER_BYTES } from '@shared/knowledge';

const MAX_COVER_WIDTH = 480;
const MAX_COVER_HEIGHT = 620;

async function renderPage(page: PDFPageProxy): Promise<Uint8Array> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    MAX_COVER_WIDTH / baseViewport.width,
    MAX_COVER_HEIGHT / baseViewport.height,
    2,
  );
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as never, viewport }).promise;
  const png = new Uint8Array(await canvas.encode('png'));
  if (png.byteLength === 0 || png.byteLength > KNOWLEDGE_MAX_COVER_BYTES) {
    throw new Error('render-failed');
  }
  return png;
}

export async function renderKnowledgeDocumentCover(
  document: PDFDocumentProxy,
): Promise<Uint8Array> {
  const page = await document.getPage(1);
  try {
    return await renderPage(page);
  } finally {
    page.cleanup();
  }
}

export async function renderKnowledgeCover(data: Uint8Array): Promise<Uint8Array> {
  const loadingTask = getDocument({
    data: data.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    stopAtErrors: true,
  });
  let document: PDFDocumentProxy | null = null;
  try {
    document = await loadingTask.promise;
    return await renderKnowledgeDocumentCover(document);
  } catch {
    throw new Error('render-failed');
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}
