import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import { KnowledgeContinuousPdf } from '../KnowledgeContinuousPdf';

vi.mock('../KnowledgePdfPage', () => ({
  KnowledgePdfPage: ({ pageIndex }: { pageIndex: number }) => (
    <div data-testid="rendered-pdf-page" data-page-index={pageIndex} />
  ),
}));

// `.knowledge-continuous-pdf` stacks its shells with a `clamp()` gap that jsdom cannot resolve, so
// the layout model below uses one representative value from that range.
const PAGE_GAP = 24;
// `scrollToPage` keeps this much of the previous page in view.
const SCROLL_CHROME = 28;
const LETTER = { width: 612, height: 792 };
const A4 = { width: 595, height: 842 };

class IntersectionObserverDouble {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: IntersectionObserverCallback) {}
}

class DOMMatrixStub {}

/**
 * pdf.js reads a page box from the page dictionary or, as here, inherits it from the page tree, so
 * a catalog with an empty page per kid is enough to give the reader a document of a chosen size.
 */
function buildUniformPdf(pageCount: number, width: number, height: number): Uint8Array {
  const pageObjectNumbers = Array.from({ length: pageCount }, (_, pageIndex) => pageIndex + 3);
  const kids = pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /MediaBox [0 0 ${width} ${height}] /Kids [${kids}] >>`,
    ...pageObjectNumbers.map(() => '<< /Type /Page /Parent 2 0 R >>'),
  ];

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  bodies.forEach((body, bodyIndex) => {
    offsets.push(pdf.length);
    pdf += `${bodyIndex + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

// The build the renderer imports targets the Chromium in Electron and calls `Promise.try` and
// `Uint8Array.prototype.toHex`, neither of which Node 22 has. pdf.js publishes the legacy build for
// exactly this; the specifier is held in a variable because only the modern path is declared.
const LEGACY_PDFJS = 'pdfjs-dist/legacy/build/pdf.mjs';

async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js instantiates a `DOMMatrix` while its canvas module initialises; jsdom ships no such
  // global and this suite never rasterises a page.
  (globalThis as Record<string, unknown>).DOMMatrix ??= DOMMatrixStub;
  const { getDocument } = (await import(LEGACY_PDFJS)) as typeof import('pdfjs-dist/build/pdf.mjs');
  return getDocument({
    data,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
  }).promise;
}

function shellsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.knowledge-page-shell')];
}

function shellHeight(shell: HTMLElement): number {
  return Number.parseFloat(shell.style.minHeight) || 0;
}

/** The document offset a browser would give the shell, given the heights the component asked for. */
function modelledOffsetTop(shell: HTMLElement): number {
  const shells = shellsOf(shell.parentElement as HTMLElement);
  return shells
    .slice(0, shells.indexOf(shell))
    .reduce((total, previous) => total + shellHeight(previous) + PAGE_GAP, 0);
}

describe('KnowledgeContinuousPdf target anchoring', () => {
  const resolveUrl = vi.fn((): KnowledgeResolvedLink => ({
    kind: 'unavailable',
    reason: 'unsupported',
  }));
  const onActivateResolvedLink = vi.fn();
  const onActivateDestination = vi.fn();
  const onCurrentPageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', IntersectionObserverDouble);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })) as unknown as typeof globalThis.matchMedia,
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    // jsdom performs no layout, so every shell reports the offset a real stack would give it. The
    // getter is live: it answers with whatever metrics the component is using at the moment of the
    // call, which is exactly what `scrollToPage` reads.
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function mockOffsetTop(
      this: HTMLElement,
    ) {
      return this.classList.contains('knowledge-page-shell') ? modelledOffsetTop(this) : 0;
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Opens a document straight onto a deep destination — the outline and global-search deep-link
   * path — and reports how far the scroll it issued sits from that destination once the shells
   * above it hold their real metrics.
   */
  async function measureDeepLinkLandingError(
    pdf: PDFDocumentProxy,
    targetPageIndex: number,
    settledPageHeight: number,
  ) {
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const { container } = render(
      <KnowledgeContinuousPdf
        pdf={pdf}
        scale={1}
        activePageIndex={targetPageIndex}
        target={{ pageIndex: targetPageIndex, top: null }}
        focusRequestKey={0}
        resolveUrl={resolveUrl}
        onActivateResolvedLink={onActivateResolvedLink}
        onActivateDestination={onActivateDestination}
        onCurrentPageChange={onCurrentPageChange}
      />,
    );
    const targetShell = shellsOf(container)[targetPageIndex];
    if (!targetShell) throw new Error(`No page shell rendered at index ${targetPageIndex}`);

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    await waitFor(() => {
      for (const shell of shellsOf(container).slice(0, targetPageIndex + 1)) {
        expect(shellHeight(shell)).toBe(settledPageHeight);
      }
    });

    const scrolledTops = scrollTo.mock.calls.map((call) => (call[0] as ScrollToOptions).top ?? 0);
    const destinationTop = Math.max(0, targetShell.offsetTop - SCROLL_CHROME);
    return {
      landingErrorPx: destinationTop - (scrolledTops.at(-1) ?? 0),
      scrolledTops,
    };
  }

  it('lands a deep link on the destination in a US Letter document', async () => {
    const bytes = readFileSync(resolve(process.cwd(), 'tests/fixtures/pdfs/oracle-sop-manual.pdf'));
    const pdf = await openPdf(new Uint8Array(bytes));
    expect(pdf.numPages).toBe(23);
    await expect(
      pdf.getPage(1).then((page) => page.getViewport({ scale: 1 })),
    ).resolves.toMatchObject(LETTER);

    const { landingErrorPx, scrolledTops } = await measureDeepLinkLandingError(pdf, 20, 792);

    expect(landingErrorPx).toBe(0);
    expect(scrolledTops).toHaveLength(1);
  });

  it('lands a deep link on the destination in an A4 document', async () => {
    const pdf = await openPdf(buildUniformPdf(23, A4.width, A4.height));
    await expect(
      pdf.getPage(1).then((page) => page.getViewport({ scale: 1 })),
    ).resolves.toMatchObject(A4);

    const { landingErrorPx, scrolledTops } = await measureDeepLinkLandingError(pdf, 20, 842);

    expect(landingErrorPx).toBe(0);
    // One scroll, straight onto the destination: the reader never sees a wrong landing corrected.
    expect(scrolledTops).toHaveLength(1);
  });

  it('still issues a deep link when a page above the destination cannot be measured', async () => {
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 5) throw new Error('page metadata unavailable');
      return {
        getViewport: () => ({ width: A4.width, height: A4.height }),
      };
    });
    const pdf = { numPages: 23, getPage } as unknown as PDFDocumentProxy;

    const { landingErrorPx } = await measureDeepLinkLandingError(pdf, 20, 842);

    expect(landingErrorPx).toBe(0);
  });
});
