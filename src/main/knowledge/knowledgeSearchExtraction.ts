import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { KNOWLEDGE_MAX_PAGES } from '@shared/knowledge';

export type KnowledgeSearchTextItem = { str: string; hasEOL: boolean };

export type KnowledgeSearchExtractedPage = {
  pageNumber: number;
  items: KnowledgeSearchTextItem[];
};

export async function extractKnowledgeSearchPages(
  data: Uint8Array,
): Promise<KnowledgeSearchExtractedPage[]> {
  const loadingTask = getDocument({
    data,
    // `isEvalSupported` is intentionally absent: pdf.js 6 removed both the option and the
    // `new Function` font/pattern path it used to gate, so passing it now only reads like
    // an active control that no longer exists.
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

    const pages: KnowledgeSearchExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pages.push({
          pageNumber,
          items: content.items.flatMap((item) =>
            'str' in item ? [{ str: item.str, hasEOL: item.hasEOL === true }] : [],
          ),
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
