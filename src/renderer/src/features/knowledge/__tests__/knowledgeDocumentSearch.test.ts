import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeKnowledgeSearchText } from '@shared/knowledgeSearch';
import {
  KnowledgeDocumentSearchController,
  matchKnowledgePage,
  normalizeKnowledgePageText,
  type KnowledgeDocumentSearchSnapshot,
} from '../knowledgeDocumentSearch';

type TextPayload = {
  items: Array<{ str: string; hasEOL: boolean }>;
  styles: Record<string, never>;
};

function pdfHarness(pageCount: number) {
  const requestedPages: number[] = [];
  const pending = new Map<
    number,
    { resolve: (value: TextPayload) => void; reject: (reason: Error) => void }
  >();
  let active = 0;
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: () => {
      requestedPages.push(pageNumber);
      active += 1;
      return new Promise<TextPayload>((resolve, reject) =>
        pending.set(pageNumber, { resolve, reject }),
      );
    },
  }));
  return {
    pdf: { numPages: pageCount, getPage } as unknown as PDFDocumentProxy,
    getPage,
    requestedPages,
    inFlight: () => active,
    resolvePage: (pageNumber: number, text: string) => {
      const request = pending.get(pageNumber);
      if (!request) throw new Error(`Page ${pageNumber} was not requested`);
      pending.delete(pageNumber);
      active -= 1;
      request.resolve({ items: [{ str: text, hasEOL: false }], styles: {} });
    },
    rejectPage: (pageNumber: number) => {
      const request = pending.get(pageNumber);
      if (!request) throw new Error(`Page ${pageNumber} was not requested`);
      pending.delete(pageNumber);
      active -= 1;
      request.reject(new Error(`Page ${pageNumber} failed`));
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('knowledge document search', () => {
  it('normalizes selectable page text while retaining text-item offsets', () => {
    const page = normalizeKnowledgePageText([
      { str: 'Reset', hasEOL: false },
      { str: '   the', hasEOL: false },
      { str: ' lane', hasEOL: true },
      { str: 'service', hasEOL: false },
    ]);

    expect(page.normalizedText).toBe('reset the lane service');
    expect(page.normalizedCharacters[10]).toEqual({
      start: { itemIndex: 2, itemOffset: 1 },
      end: { itemIndex: 2, itemOffset: 2 },
    });
  });

  it('normalizes PDF text exactly like the server passage builder across text items', () => {
    const items = [
      { str: 'Ｃａｆｅ', hasEOL: false },
      { str: '\u0301  FAILOVER', hasEOL: true },
    ];

    const page = normalizeKnowledgePageText(items);

    expect(page.normalizedText).toBe(normalizeKnowledgeSearchText('Ｃａｆｅ\u0301  FAILOVER '));
    expect(page.normalizedCharacters).toHaveLength(page.normalizedText.length);
    expect(page.normalizedCharacters[3]).toEqual({
      start: { itemIndex: 0, itemOffset: 3 },
      end: { itemIndex: 1, itemOffset: 1 },
    });
  });

  it('maps both UTF-16 units of an astral character to its complete PDF DOM range', () => {
    const page = normalizeKnowledgePageText([{ str: 'A😀B', hasEOL: false }]);

    expect(page.normalizedText).toBe('a😀b');
    expect(page.normalizedCharacters[1]).toEqual({
      start: { itemIndex: 0, itemOffset: 1 },
      end: { itemIndex: 0, itemOffset: 3 },
    });
    expect(page.normalizedCharacters[2]).toEqual(page.normalizedCharacters[1]);
    expect(
      matchKnowledgePage({ page, pageIndex: 0, normalizedQuery: '😀', outline: [] })[0]?.domRange,
    ).toEqual({
      start: { itemIndex: 0, itemOffset: 1 },
      end: { itemIndex: 0, itemOffset: 3 },
    });
  });

  it('retains the inserted EOL source position while spanning adjacent PDF text items', () => {
    const page = normalizeKnowledgePageText([
      { str: 'abc', hasEOL: true },
      { str: 'def', hasEOL: false },
    ]);

    expect(page.normalizedText).toBe('abc def');
    expect(page.normalizedCharacters[3]).toEqual({
      start: { itemIndex: 0, itemOffset: 3 },
      end: { itemIndex: 0, itemOffset: 3 },
    });
    expect(
      matchKnowledgePage({ page, pageIndex: 0, normalizedQuery: 'c d', outline: [] })[0]?.domRange,
    ).toEqual({
      start: { itemIndex: 0, itemOffset: 2 },
      end: { itemIndex: 1, itemOffset: 1 },
    });
  });

  it('returns stable public offsets and private DOM offsets for every match', () => {
    const page = normalizeKnowledgePageText([
      { str: 'Reset the lane', hasEOL: true },
      { str: 'Reset the lane', hasEOL: false },
    ]);
    const matches = matchKnowledgePage({
      page,
      pageIndex: 4,
      normalizedQuery: 'reset the lane',
      outline: [{ id: 'reset', label: 'Lane recovery', level: 1, pageIndex: 4, top: 600 }],
    });

    expect(
      matches.map(({ pageIndex, matchIndex, sectionLabel }) => ({
        pageIndex,
        matchIndex,
        sectionLabel,
      })),
    ).toEqual([
      { pageIndex: 4, matchIndex: 0, sectionLabel: 'Lane recovery' },
      { pageIndex: 4, matchIndex: 1, sectionLabel: 'Lane recovery' },
    ]);
    expect(matches[1]?.textItemRange).toEqual({ start: 1, end: 1 });
    expect(matches[1]?.domRange.start.itemIndex).toBe(1);
  });

  it('treats short alphanumeric queries as complete tokens', () => {
    const page = normalizeKnowledgePageText([
      { str: 'Performing RF scanner and RFID checks', hasEOL: false },
    ]);

    const matches = matchKnowledgePage({
      page,
      pageIndex: 0,
      normalizedQuery: 'rf',
      outline: [],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.snippet).toContain('performing rf scanner');
    expect(matches[0]?.domRange).toEqual({
      start: { itemIndex: 0, itemOffset: 11 },
      end: { itemIndex: 0, itemOffset: 13 },
    });
  });

  it('prioritizes the current page and never exceeds three extraction workers', async () => {
    const harness = pdfHarness(8);
    const controller = new KnowledgeDocumentSearchController({
      pdf: harness.pdf,
      documentId: 'priority-guide',
      checksum: 'a'.repeat(64),
      outline: [],
      initialPageIndex: 5,
      concurrency: 3,
    });

    controller.setQuery('lane');
    await vi.waitFor(() => expect(harness.requestedPages).toHaveLength(3));
    expect(harness.requestedPages[0]).toBe(6);
    expect(harness.inFlight()).toBeLessThanOrEqual(3);
    controller.dispose();
  });

  it('publishes matches progressively in stable page order and reuses extracted pages', async () => {
    const harness = pdfHarness(3);
    const snapshots: KnowledgeDocumentSearchSnapshot[] = [];
    const controller = new KnowledgeDocumentSearchController({
      pdf: harness.pdf,
      documentId: 'progressive-guide',
      checksum: 'b'.repeat(64),
      outline: [],
      initialPageIndex: 1,
    });
    controller.subscribe((snapshot) => snapshots.push(snapshot));
    controller.setQuery('lane');
    await vi.waitFor(() => expect(harness.requestedPages).toHaveLength(3));

    harness.resolvePage(2, 'lane on the middle page');
    await settle();
    expect(snapshots.at(-1)?.results.map(({ pageIndex }) => pageIndex)).toEqual([1]);
    harness.resolvePage(3, 'lane on the final page');
    harness.resolvePage(1, 'lane on the first page');
    await vi.waitFor(() => expect(controller.getSnapshot().state).toBe('ready'));
    expect(controller.getSnapshot().results.map(({ pageIndex }) => pageIndex)).toEqual([0, 1, 2]);

    controller.setQuery('final');
    expect(harness.getPage).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().results.map(({ pageIndex }) => pageIndex)).toEqual([2]);
    controller.dispose();
  });

  it('keeps successful matches actionable when one page extraction fails', async () => {
    const harness = pdfHarness(2);
    const controller = new KnowledgeDocumentSearchController({
      pdf: harness.pdf,
      documentId: 'partial-guide',
      checksum: 'c'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    controller.setQuery('lane');
    await vi.waitFor(() => expect(harness.requestedPages).toHaveLength(2));
    harness.resolvePage(1, 'lane reset');
    harness.rejectPage(2);

    await vi.waitFor(() => expect(controller.getSnapshot().state).toBe('partial'));
    expect(controller.getSnapshot().results).toHaveLength(1);
    expect(controller.getSnapshot().failedPageIndices).toEqual([1]);
    controller.dispose();
  });

  it('reports unavailable only after every page has no selectable text', async () => {
    const harness = pdfHarness(2);
    const controller = new KnowledgeDocumentSearchController({
      pdf: harness.pdf,
      documentId: 'image-guide',
      checksum: 'd'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    controller.setQuery('lane');
    await vi.waitFor(() => expect(harness.requestedPages).toHaveLength(2));
    harness.resolvePage(1, '   ');
    harness.resolvePage(2, '');

    await vi.waitFor(() => expect(controller.getSnapshot().state).toBe('unavailable'));
    expect(controller.getSnapshot().searchablePageCount).toBe(0);
    controller.dispose();
  });

  it('reuses page text only for the same document and checksum identity', async () => {
    const first = pdfHarness(1);
    const firstController = new KnowledgeDocumentSearchController({
      pdf: first.pdf,
      documentId: 'cached-guide',
      checksum: 'e'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    firstController.setQuery('lane');
    await vi.waitFor(() => expect(first.requestedPages).toEqual([1]));
    first.resolvePage(1, 'lane reset');
    await vi.waitFor(() => expect(firstController.getSnapshot().state).toBe('ready'));
    firstController.dispose();

    const same = pdfHarness(1);
    const sameController = new KnowledgeDocumentSearchController({
      pdf: same.pdf,
      documentId: 'cached-guide',
      checksum: 'e'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    sameController.setQuery('lane');
    expect(same.requestedPages).toEqual([]);
    expect(sameController.getSnapshot().results).toHaveLength(1);

    const replacement = pdfHarness(1);
    const replacementController = new KnowledgeDocumentSearchController({
      pdf: replacement.pdf,
      documentId: 'cached-guide',
      checksum: 'f'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    replacementController.setQuery('lane');
    await vi.waitFor(() => expect(replacement.requestedPages).toEqual([1]));
    sameController.dispose();
    replacementController.dispose();
  });

  it('rejects stale page completions after disposal', async () => {
    const harness = pdfHarness(2);
    const snapshots: KnowledgeDocumentSearchSnapshot[] = [];
    const controller = new KnowledgeDocumentSearchController({
      pdf: harness.pdf,
      documentId: 'disposed-guide',
      checksum: '1'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });
    controller.subscribe((snapshot) => snapshots.push(snapshot));
    controller.setQuery('lane');
    await vi.waitFor(() => expect(harness.requestedPages).toHaveLength(2));
    controller.dispose();
    harness.resolvePage(1, 'lane');
    await settle();

    expect(snapshots.at(-1)?.results).toHaveLength(0);
  });

  it('maps a canonical external target to PDF text-layer positions', async () => {
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [
          {
            str: pageNumber === 7 ? 'Start failover procedure now' : '',
            hasEOL: false,
          },
        ],
        styles: {},
      }),
    }));
    const controller = new KnowledgeDocumentSearchController({
      pdf: { numPages: 7, getPage } as unknown as PDFDocumentProxy,
      documentId: 'external-guide',
      checksum: '2'.repeat(64),
      outline: [],
      initialPageIndex: 0,
      concurrency: 1,
    });

    const match = await controller.resolveExternalMatch({
      pageIndex: 6,
      normalizedStart: 6,
      normalizedEnd: 14,
      highlightText: 'failover',
    });

    expect(getPage).toHaveBeenCalledWith(7);
    expect(match).toMatchObject({ pageIndex: 6, normalizedStart: 6, normalizedEnd: 14 });
    expect(match?.domRange).toEqual({
      start: { itemIndex: 0, itemOffset: 6 },
      end: { itemIndex: 0, itemOffset: 14 },
    });
    controller.dispose();
  });

  it('uses the nearest page-scoped canonical occurrence when stored offsets drift', async () => {
    const getPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover first then failover second', hasEOL: false }],
        styles: {},
      }),
    }));
    const controller = new KnowledgeDocumentSearchController({
      pdf: { numPages: 1, getPage } as unknown as PDFDocumentProxy,
      documentId: 'drift-guide',
      checksum: '3'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });

    const match = await controller.resolveExternalMatch({
      pageIndex: 0,
      normalizedStart: 19,
      normalizedEnd: 27,
      highlightText: 'FAILOVER',
    });

    expect(match).toMatchObject({ normalizedStart: 20, normalizedEnd: 28 });
    expect(match?.domRange.start).toEqual({ itemIndex: 0, itemOffset: 20 });
    controller.dispose();
  });

  it('validates a stale normalized end before resolving the nearest canonical occurrence', async () => {
    const getPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover first then failover second', hasEOL: false }],
        styles: {},
      }),
    }));
    const controller = new KnowledgeDocumentSearchController({
      pdf: { numPages: 1, getPage } as unknown as PDFDocumentProxy,
      documentId: 'stale-end-guide',
      checksum: '5'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });

    const match = await controller.resolveExternalMatch({
      pageIndex: 0,
      normalizedStart: 20,
      normalizedEnd: 27,
      highlightText: 'failover',
    });

    expect(match).toMatchObject({ normalizedStart: 20, normalizedEnd: 28 });
    expect(match?.domRange.end).toEqual({ itemIndex: 0, itemOffset: 28 });
    controller.dispose();
  });

  it('returns null when canonical external text is not selectable on the requested page', async () => {
    const getPage = vi.fn(async () => ({
      getTextContent: async () => ({ items: [{ str: 'Other text', hasEOL: false }], styles: {} }),
    }));
    const controller = new KnowledgeDocumentSearchController({
      pdf: { numPages: 1, getPage } as unknown as PDFDocumentProxy,
      documentId: 'missing-guide',
      checksum: '4'.repeat(64),
      outline: [],
      initialPageIndex: 0,
    });

    await expect(
      controller.resolveExternalMatch({
        pageIndex: 0,
        normalizedStart: 0,
        normalizedEnd: 8,
        highlightText: 'failover',
      }),
    ).resolves.toBeNull();
    controller.dispose();
  });
});
