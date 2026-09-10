import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  KNOWLEDGE_MAX_PAGES,
  KNOWLEDGE_SEARCH_MAX_PAGE_TEXT,
  KNOWLEDGE_SEARCH_MAX_DOCUMENT_TEXT,
  KNOWLEDGE_SEARCH_MAX_TEXT_ITEMS,
} from '@shared/knowledge';

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
    const budget = { text: 0, items: 0 };
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const items = await readPageItems(page, budget);
        pages.push({ pageNumber, items });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function readPageItems(
  page: PDFPageProxy,
  budget: { text: number; items: number },
): Promise<KnowledgeSearchTextItem[]> {
  const items: KnowledgeSearchTextItem[] = [];
  const reader = page.streamTextContent().getReader();
  let pageText = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if (!('str' in item)) continue;
        const length = item.str.length + (item.hasEOL ? 1 : 0);
        pageText += length;
        budget.text += length;
        budget.items += 1;
        if (
          pageText > KNOWLEDGE_SEARCH_MAX_PAGE_TEXT ||
          budget.text > KNOWLEDGE_SEARCH_MAX_DOCUMENT_TEXT ||
          budget.items > KNOWLEDGE_SEARCH_MAX_TEXT_ITEMS
        )
          throw new Error('search-text-limit');
        items.push({ str: item.str, hasEOL: item.hasEOL === true });
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return items;
}
