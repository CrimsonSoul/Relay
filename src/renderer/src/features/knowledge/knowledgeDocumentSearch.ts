import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgeOutlineNode } from '@shared/knowledge';
import {
  normalizeKnowledgeSearchText,
  normalizeKnowledgeSearchTextWithRanges,
} from '@shared/knowledgeSearch';

export type KnowledgeDocumentSearchResult = {
  id: string;
  pageIndex: number;
  matchIndex: number;
  snippet: string;
  sectionLabel: string | null;
  normalizedStart: number;
  normalizedEnd: number;
  textItemRange: { start: number; end: number };
};

export type KnowledgeTextPosition = { itemIndex: number; itemOffset: number };

export type KnowledgeTextRange = {
  start: KnowledgeTextPosition;
  end: KnowledgeTextPosition;
};

export type KnowledgeSearchPage = {
  normalizedText: string;
  normalizedCharacters: KnowledgeTextRange[];
};

export type KnowledgeExternalSearchTarget = {
  pageIndex: number;
  normalizedStart: number;
  normalizedEnd: number;
  highlightText: string;
};

export type KnowledgeDocumentSearchMatch = KnowledgeDocumentSearchResult & {
  domRange: { start: KnowledgeTextPosition; end: KnowledgeTextPosition };
};

export type KnowledgeDocumentSearchState =
  | 'idle'
  | 'indexing'
  | 'ready'
  | 'partial'
  | 'unavailable';

export type KnowledgeDocumentSearchSnapshot = {
  query: string;
  normalizedQuery: string;
  state: KnowledgeDocumentSearchState;
  results: readonly KnowledgeDocumentSearchMatch[];
  completedPages: number;
  totalPages: number;
  failedPageIndices: readonly number[];
  searchablePageCount: number;
};

type PageTextItem = { str: string; hasEOL?: boolean };

const DEFAULT_SEARCH_CONCURRENCY = 3;
const MAX_SESSION_CACHE_ENTRIES = 2;
const SNIPPET_CONTEXT_LENGTH = 54;
const sessionCache = new Map<string, Map<number, KnowledgeSearchPage>>();

export function normalizeKnowledgeSearchQuery(value: string): string {
  return normalizeKnowledgeSearchText(value);
}

export function normalizeKnowledgePageText(items: readonly PageTextItem[]): KnowledgeSearchPage {
  const rawPositions: KnowledgeTextRange[] = [];
  let rawText = '';
  const appendRaw = (value: string, itemIndex: number, itemOffset: number) => {
    rawText += value;
    for (let codeUnit = 0; codeUnit < value.length; codeUnit += 1) {
      rawPositions.push({
        start: { itemIndex, itemOffset: itemOffset + codeUnit },
        end: { itemIndex, itemOffset: itemOffset + codeUnit + 1 },
      });
    }
  };

  items.forEach((item, itemIndex) => {
    appendRaw(item.str, itemIndex, 0);
    if (item.hasEOL) {
      rawText += ' ';
      rawPositions.push({
        start: { itemIndex, itemOffset: item.str.length },
        end: { itemIndex, itemOffset: item.str.length },
      });
    }
  });

  const normalized = normalizeKnowledgeSearchTextWithRanges(rawText);
  const normalizedCharacters = normalized.sourceRanges.map(({ start, end }) => ({
    start: rawPositions[start]?.start ?? { itemIndex: 0, itemOffset: 0 },
    end: rawPositions[end - 1]?.end ?? rawPositions[start]?.end ?? { itemIndex: 0, itemOffset: 0 },
  }));

  if (normalized.text !== normalizeKnowledgeSearchText(rawText)) {
    throw new Error('Knowledge PDF text normalization drifted from the shared contract');
  }
  return { normalizedText: normalized.text, normalizedCharacters };
}

function sectionLabelForPage(
  outline: readonly KnowledgeOutlineNode[],
  pageIndex: number,
): string | null {
  let sectionLabel: string | null = null;
  for (const node of outline) {
    if (node.pageIndex <= pageIndex) sectionLabel = node.label;
  }
  return sectionLabel;
}

function snippetForMatch(text: string, start: number, end: number): string {
  const snippetStart = Math.max(0, start - SNIPPET_CONTEXT_LENGTH);
  const snippetEnd = Math.min(text.length, end + SNIPPET_CONTEXT_LENGTH);
  const prefix = snippetStart > 0 ? '…' : '';
  const suffix = snippetEnd < text.length ? '…' : '';
  return `${prefix}${text.slice(snippetStart, snippetEnd).trim()}${suffix}`;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

function requiresTokenBoundaries(query: string): boolean {
  return [...query].length <= 2 && /^[\p{L}\p{N}]+$/u.test(query);
}

function isTokenMatch(text: string, start: number, end: number): boolean {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
}

export function matchKnowledgePage({
  page,
  pageIndex,
  normalizedQuery,
  outline,
}: {
  page: KnowledgeSearchPage;
  pageIndex: number;
  normalizedQuery: string;
  outline: readonly KnowledgeOutlineNode[];
}): KnowledgeDocumentSearchMatch[] {
  if (!normalizedQuery) return [];
  const matches: KnowledgeDocumentSearchMatch[] = [];
  let normalizedStart = page.normalizedText.indexOf(normalizedQuery);

  while (normalizedStart >= 0) {
    const normalizedEnd = normalizedStart + normalizedQuery.length;
    if (
      requiresTokenBoundaries(normalizedQuery) &&
      !isTokenMatch(page.normalizedText, normalizedStart, normalizedEnd)
    ) {
      normalizedStart = page.normalizedText.indexOf(normalizedQuery, normalizedEnd);
      continue;
    }
    const firstCharacter = page.normalizedCharacters[normalizedStart];
    const finalCharacter = page.normalizedCharacters[normalizedEnd - 1];
    if (firstCharacter && finalCharacter) {
      const matchIndex = matches.length;
      const start = firstCharacter.start;
      const end = finalCharacter.end;
      matches.push({
        id: `${pageIndex}:${normalizedStart}:${matchIndex}`,
        pageIndex,
        matchIndex,
        snippet: snippetForMatch(page.normalizedText, normalizedStart, normalizedEnd),
        sectionLabel: sectionLabelForPage(outline, pageIndex),
        normalizedStart,
        normalizedEnd,
        textItemRange: { start: start.itemIndex, end: end.itemIndex },
        domRange: { start, end },
      });
    }
    normalizedStart = page.normalizedText.indexOf(normalizedQuery, normalizedEnd);
  }

  return matches;
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  return Math.min(Math.max(0, Math.floor(pageIndex)), Math.max(0, pageCount - 1));
}

function cacheForIdentity(documentId: string, checksum: string): Map<number, KnowledgeSearchPage> {
  const key = `${documentId}:${checksum}`;
  const existing = sessionCache.get(key);
  if (existing) {
    sessionCache.delete(key);
    sessionCache.set(key, existing);
    return existing;
  }

  const cache = new Map<number, KnowledgeSearchPage>();
  sessionCache.set(key, cache);
  while (sessionCache.size > MAX_SESSION_CACHE_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    sessionCache.delete(oldestKey);
  }
  return cache;
}

export class KnowledgeDocumentSearchController {
  private readonly pdf: PDFDocumentProxy;
  private readonly outline: readonly KnowledgeOutlineNode[];
  private readonly concurrency: number;
  private readonly pageCache: Map<number, KnowledgeSearchPage>;
  private readonly listeners = new Set<(snapshot: KnowledgeDocumentSearchSnapshot) => void>();
  private readonly activePageIndices = new Set<number>();
  private readonly failedPageIndices = new Set<number>();
  private readonly pageWaiters = new Map<number, Set<(page: KnowledgeSearchPage | null) => void>>();
  private pendingPageIndices: number[];
  private snapshot: KnowledgeDocumentSearchSnapshot;
  private generation = 1;
  private indexingStarted = false;
  private disposed = false;

  constructor(options: {
    pdf: PDFDocumentProxy;
    documentId: string;
    checksum: string;
    outline: readonly KnowledgeOutlineNode[];
    initialPageIndex: number;
    concurrency?: number;
  }) {
    this.pdf = options.pdf;
    this.outline = options.outline;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_SEARCH_CONCURRENCY));
    this.pageCache = cacheForIdentity(options.documentId, options.checksum);
    const initialPageIndex = clampPageIndex(options.initialPageIndex, this.pdf.numPages);
    this.pendingPageIndices = [
      initialPageIndex,
      ...Array.from({ length: this.pdf.numPages }, (_, pageIndex) => pageIndex).filter(
        (pageIndex) => pageIndex !== initialPageIndex,
      ),
    ].filter((pageIndex) => !this.pageCache.has(pageIndex));
    this.snapshot = {
      query: '',
      normalizedQuery: '',
      state: 'idle',
      results: [],
      completedPages: this.pageCache.size,
      totalPages: this.pdf.numPages,
      failedPageIndices: [],
      searchablePageCount: this.searchablePageCount(),
    };
  }

  subscribe(listener: (snapshot: KnowledgeDocumentSearchSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): KnowledgeDocumentSearchSnapshot {
    return this.snapshot;
  }

  setQuery(query: string): void {
    if (this.disposed) return;
    const normalizedQuery = normalizeKnowledgeSearchQuery(query);
    this.snapshot = { ...this.snapshot, query, normalizedQuery };
    if (!normalizedQuery) {
      this.publish({ state: 'idle', results: [] });
      return;
    }

    this.indexingStarted = true;
    this.publishSearchSnapshot();
    this.pump();
  }

  setCurrentPage(pageIndex: number): void {
    if (this.disposed) return;
    const currentPageIndex = clampPageIndex(pageIndex, this.pdf.numPages);
    const pendingIndex = this.pendingPageIndices.indexOf(currentPageIndex);
    if (pendingIndex >= 0) {
      this.pendingPageIndices.splice(pendingIndex, 1);
      this.pendingPageIndices.unshift(currentPageIndex);
    }
    if (this.indexingStarted) this.pump();
  }

  async resolveExternalMatch(
    target: KnowledgeExternalSearchTarget,
  ): Promise<KnowledgeDocumentSearchMatch | null> {
    if (
      this.disposed ||
      !Number.isSafeInteger(target.pageIndex) ||
      !Number.isSafeInteger(target.normalizedStart) ||
      !Number.isSafeInteger(target.normalizedEnd) ||
      target.normalizedStart < 0 ||
      target.normalizedEnd <= target.normalizedStart
    ) {
      return null;
    }
    const normalizedHighlight = normalizeKnowledgeSearchText(target.highlightText);
    if (!normalizedHighlight) return null;

    const pageIndex = clampPageIndex(target.pageIndex, this.pdf.numPages);
    const generation = this.generation;
    const page = await this.loadPage(pageIndex);
    if (!page || !this.isCurrent(generation)) return null;

    let normalizedStart = target.normalizedStart;
    let normalizedEnd = target.normalizedEnd;
    if (page.normalizedText.slice(normalizedStart, normalizedEnd) !== normalizedHighlight) {
      const occurrences: number[] = [];
      let occurrence = page.normalizedText.indexOf(normalizedHighlight);
      while (occurrence >= 0) {
        occurrences.push(occurrence);
        occurrence = page.normalizedText.indexOf(normalizedHighlight, occurrence + 1);
      }
      normalizedStart =
        occurrences.toSorted(
          (left, right) =>
            Math.abs(left - target.normalizedStart) - Math.abs(right - target.normalizedStart) ||
            left - right,
        )[0] ?? -1;
      if (normalizedStart < 0) return null;
      normalizedEnd = normalizedStart + normalizedHighlight.length;
    }

    const firstCharacter = page.normalizedCharacters[normalizedStart];
    const finalCharacter = page.normalizedCharacters[normalizedEnd - 1];
    if (!firstCharacter || !finalCharacter) return null;
    const start = firstCharacter.start;
    const end = finalCharacter.end;
    return {
      id: `external:${pageIndex}:${normalizedStart}:${normalizedEnd}`,
      pageIndex,
      matchIndex: 0,
      snippet: snippetForMatch(page.normalizedText, normalizedStart, normalizedEnd),
      sectionLabel: sectionLabelForPage(this.outline, pageIndex),
      normalizedStart,
      normalizedEnd,
      textItemRange: { start: start.itemIndex, end: end.itemIndex },
      domRange: { start, end },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.listeners.clear();
    this.pendingPageIndices = [];
    for (const waiters of this.pageWaiters.values()) {
      for (const resolve of waiters) resolve(null);
    }
    this.pageWaiters.clear();
  }

  private searchablePageCount(): number {
    return Array.from(this.pageCache.values()).filter(({ normalizedText }) =>
      Boolean(normalizedText),
    ).length;
  }

  private matches(): KnowledgeDocumentSearchMatch[] {
    if (!this.snapshot.normalizedQuery) return [];
    return Array.from(this.pageCache.entries())
      .flatMap(([pageIndex, page]) =>
        matchKnowledgePage({
          page,
          pageIndex,
          normalizedQuery: this.snapshot.normalizedQuery,
          outline: this.outline,
        }),
      )
      .toSorted(
        (left, right) =>
          left.pageIndex - right.pageIndex ||
          left.normalizedStart - right.normalizedStart ||
          left.matchIndex - right.matchIndex,
      );
  }

  private state(): KnowledgeDocumentSearchState {
    if (!this.snapshot.normalizedQuery) return 'idle';
    const completedPages = this.pageCache.size + this.failedPageIndices.size;
    if (completedPages < this.pdf.numPages) return 'indexing';
    if (this.searchablePageCount() === 0) return 'unavailable';
    if (this.failedPageIndices.size > 0) return 'partial';
    return 'ready';
  }

  private publishSearchSnapshot(): void {
    this.publish({ state: this.state(), results: this.matches() });
  }

  private publish(changes: Pick<KnowledgeDocumentSearchSnapshot, 'state' | 'results'>): void {
    if (this.disposed) return;
    this.snapshot = {
      ...this.snapshot,
      ...changes,
      completedPages: this.pageCache.size + this.failedPageIndices.size,
      failedPageIndices: Array.from(this.failedPageIndices).toSorted((left, right) => left - right),
      searchablePageCount: this.searchablePageCount(),
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private pump(): void {
    if (this.disposed || (!this.indexingStarted && this.pageWaiters.size === 0)) return;
    while (this.activePageIndices.size < this.concurrency && this.pendingPageIndices.length > 0) {
      const pendingOffset = this.indexingStarted
        ? 0
        : this.pendingPageIndices.findIndex((pageIndex) => this.pageWaiters.has(pageIndex));
      if (pendingOffset < 0) break;
      const [pageIndex] = this.pendingPageIndices.splice(pendingOffset, 1);
      if (pageIndex === undefined) break;
      if (this.pageCache.has(pageIndex) || this.activePageIndices.has(pageIndex)) continue;
      this.activePageIndices.add(pageIndex);
      void this.extractPage(pageIndex, this.generation);
    }
  }

  private async extractPage(pageIndex: number, generation: number): Promise<void> {
    try {
      const page = await this.pdf.getPage(pageIndex + 1);
      if (!this.isCurrent(generation)) return;
      const textContent = await page.getTextContent();
      if (!this.isCurrent(generation)) return;
      const items = textContent.items.filter(
        (item): item is (typeof textContent.items)[number] & PageTextItem =>
          typeof (item as Partial<PageTextItem>).str === 'string',
      );
      this.pageCache.set(pageIndex, normalizeKnowledgePageText(items));
    } catch {
      if (this.isCurrent(generation)) this.failedPageIndices.add(pageIndex);
    } finally {
      if (this.isCurrent(generation)) {
        this.activePageIndices.delete(pageIndex);
        this.settlePageWaiters(pageIndex, this.pageCache.get(pageIndex) ?? null);
        this.publishSearchSnapshot();
        this.pump();
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private loadPage(pageIndex: number): Promise<KnowledgeSearchPage | null> {
    const cached = this.pageCache.get(pageIndex);
    if (cached) return Promise.resolve(cached);
    if (this.disposed || this.failedPageIndices.has(pageIndex)) return Promise.resolve(null);

    return new Promise((resolve) => {
      const waiters = this.pageWaiters.get(pageIndex);
      if (waiters) waiters.add(resolve);
      else this.pageWaiters.set(pageIndex, new Set([resolve]));

      if (!this.activePageIndices.has(pageIndex)) {
        const pendingIndex = this.pendingPageIndices.indexOf(pageIndex);
        if (pendingIndex >= 0) this.pendingPageIndices.splice(pendingIndex, 1);
        this.pendingPageIndices.unshift(pageIndex);
      }
      this.pump();
    });
  }

  private settlePageWaiters(pageIndex: number, page: KnowledgeSearchPage | null): void {
    const waiters = this.pageWaiters.get(pageIndex);
    if (!waiters) return;
    this.pageWaiters.delete(pageIndex);
    for (const resolve of waiters) resolve(page);
  }
}
