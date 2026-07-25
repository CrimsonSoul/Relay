import { getDocument, type PDFDocumentProxy, type TextItem } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  KNOWLEDGE_MAX_PAGES,
  type KnowledgeOutlineNode,
  type KnowledgeOutlineSource,
} from '@shared/knowledge';
import {
  inferKnowledgeOutline,
  normalizeNativeKnowledgeOutline,
  type KnowledgeDestination,
  type KnowledgeTextPage,
  type NativeKnowledgeOutlineEntry,
} from './knowledgeOutline';
import { renderKnowledgeDocumentCover } from './knowledgeCover';

export type KnowledgeExtractionResult = {
  metadataTitle: string | null;
  pageCount: number;
  outline: KnowledgeOutlineNode[];
  outlineSource: KnowledgeOutlineSource;
  coverPng: Uint8Array;
};

function destinationType(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (!Array.isArray(value) && typeof value === 'object' && 'name' in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

async function resolvePdfDestination(
  document: PDFDocumentProxy,
  destination: NativeKnowledgeOutlineEntry['dest'],
): Promise<KnowledgeDestination | null> {
  let resolved: Awaited<ReturnType<PDFDocumentProxy['getDestination']>> | null;
  try {
    resolved =
      typeof destination === 'string' ? await document.getDestination(destination) : destination;
  } catch {
    return null;
  }
  if (!Array.isArray(resolved) || resolved.length < 2) return null;

  const reference = resolved[0];
  let pageIndex: number;
  if (Number.isInteger(reference)) pageIndex = reference as number;
  else if (reference && typeof reference === 'object') {
    try {
      pageIndex = await document.getPageIndex(reference);
    } catch {
      return null;
    }
  } else return null;
  if (pageIndex < 0 || pageIndex >= document.numPages) return null;

  const type = destinationType(resolved[1]);
  if (type === null) return null;
  let topCandidate: unknown = null;
  if (type === 'XYZ') topCandidate = resolved[3];
  else if (/^(?:FitH|FitBH)$/.test(type)) topCandidate = resolved[2];
  const top =
    typeof topCandidate === 'number' && Number.isFinite(topCandidate) && topCandidate >= 0
      ? topCandidate
      : null;
  return { pageIndex, top };
}

function asNativeOutline(
  value: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
): NativeKnowledgeOutlineEntry[] {
  return (value ?? []).map((entry) => ({
    title: entry.title,
    dest: entry.dest,
    items: asNativeOutline(entry.items),
  }));
}

async function extractTextPages(document: PDFDocumentProxy): Promise<KnowledgeTextPage[]> {
  const pages: KnowledgeTextPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      pages.push({
        pageIndex: pageNumber - 1,
        height: page.getViewport({ scale: 1 }).height,
        items: content.items
          .filter((item): item is TextItem => 'str' in item)
          .map((item) => ({
            str: item.str,
            transform: item.transform.map(Number),
            width: item.width,
            fontName: item.fontName,
          })),
      });
    } finally {
      page.cleanup();
    }
  }
  return pages;
}

function metadataTitle(info: object): string | null {
  const title = 'Title' in info ? (info as { Title?: unknown }).Title : null;
  if (typeof title !== 'string') return null;
  const hasUnsafeCharacter = Array.from(title).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 31 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
  if (hasUnsafeCharacter) return null;
  const normalized = title.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 && normalized.length <= 240 ? normalized : null;
}

function normalizedExtractionError(error: unknown): Error {
  const message = error instanceof Error ? error.message.toLocaleLowerCase('en') : '';
  if (message.includes('password')) return new Error('encrypted-pdf');
  if (message.includes('page-limit')) return new Error('page-limit');
  return new Error('invalid-pdf');
}

export async function extractKnowledgePdf(data: Uint8Array): Promise<KnowledgeExtractionResult> {
  const loadingTask = getDocument({
    data,
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
    if (document.numPages < 1 || document.numPages > KNOWLEDGE_MAX_PAGES) {
      throw new Error('page-limit');
    }

    const [metadata, rawOutline, coverPng] = await Promise.all([
      document.getMetadata(),
      document.getOutline(),
      renderKnowledgeDocumentCover(document),
    ]);
    const nativeOutline = await normalizeNativeKnowledgeOutline(
      asNativeOutline(rawOutline),
      (destination) => resolvePdfDestination(document as PDFDocumentProxy, destination),
    );
    if (nativeOutline.length > 0) {
      return {
        metadataTitle: metadataTitle(metadata.info),
        pageCount: document.numPages,
        outline: nativeOutline,
        outlineSource: 'native',
        coverPng,
      };
    }

    const inferredOutline = inferKnowledgeOutline(await extractTextPages(document));
    return {
      metadataTitle: metadataTitle(metadata.info),
      pageCount: document.numPages,
      outline: inferredOutline,
      outlineSource: inferredOutline.length > 0 ? 'inferred' : 'none',
      coverPng,
    };
  } catch (error) {
    throw normalizedExtractionError(error);
  } finally {
    await loadingTask.destroy();
  }
}
