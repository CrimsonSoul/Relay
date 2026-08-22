import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeDocumentSearchMatch,
  KnowledgeDocumentSearchSnapshot,
} from '../knowledgeDocumentSearch';
import { KnowledgeDocumentSearchResults } from '../KnowledgeDocumentSearchResults';
import type { KnowledgeDocumentSearchDisplayResult } from '../useKnowledgeDocumentSearch';

const knowledgeStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);

function panelMatch(index: number): KnowledgeDocumentSearchMatch {
  return {
    id: `2:${index}:0`,
    pageIndex: 2,
    matchIndex: index,
    snippet: `Restart the lane service ${index + 1}`,
    sectionLabel: 'Lane recovery',
    normalizedStart: index * 10,
    normalizedEnd: index * 10 + 7,
    textItemRange: { start: index, end: index },
    domRange: {
      start: { itemIndex: index, itemOffset: 0 },
      end: { itemIndex: index, itemOffset: 7 },
    },
  };
}

function snapshot(
  overrides: Partial<KnowledgeDocumentSearchSnapshot> = {},
): KnowledgeDocumentSearchSnapshot {
  return {
    query: 'lane',
    normalizedQuery: 'lane',
    state: 'ready',
    results: [panelMatch(0), panelMatch(1)],
    completedPages: 20,
    totalPages: 20,
    failedPageIndices: [],
    searchablePageCount: 20,
    ...overrides,
  };
}

function displayResults(
  currentSnapshot: KnowledgeDocumentSearchSnapshot,
): KnowledgeDocumentSearchDisplayResult[] {
  return currentSnapshot.results.map((match) => ({
    source: 'local-exact' as const,
    id: `local:${match.id}`,
    match,
  }));
}

describe('KnowledgeDocumentSearchResults', () => {
  it('exposes native list items with tabbable result actions and the current location', () => {
    const currentSnapshot = snapshot();
    render(
      <KnowledgeDocumentSearchResults
        snapshot={currentSnapshot}
        results={displayResults(currentSnapshot)}
        enhancedUnavailable={false}
        activeResultIndex={1}
        onActivate={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: 'Matches' });
    const items = within(list).getAllByRole('listitem');
    const actions = within(list).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toHaveProperty('tabIndex', 0);
    expect(actions[1]).toHaveProperty('tabIndex', 0);
    expect(actions[1]).toHaveAttribute('aria-current', 'location');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('shows progressive count and keeps found results actionable', () => {
    const onActivate = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const currentSnapshot = snapshot({ state: 'indexing', completedPages: 4, totalPages: 20 });
    render(
      <KnowledgeDocumentSearchResults
        snapshot={currentSnapshot}
        results={displayResults(currentSnapshot)}
        enhancedUnavailable={false}
        activeResultIndex={0}
        onActivate={onActivate}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );

    expect(screen.getByText('2 matches · 4 of 20 pages searched')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Page 3, Lane recovery, Restart the lane service 1/ }),
    );
    expect(onActivate).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('distinguishes no matches from unavailable selectable text', () => {
    const props = {
      activeResultIndex: -1,
      enhancedUnavailable: false,
      onActivate: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    };
    const { rerender } = render(
      <KnowledgeDocumentSearchResults
        snapshot={snapshot({ results: [] })}
        results={[]}
        {...props}
      />,
    );
    expect(screen.getByText('No matches in this guide')).toBeInTheDocument();

    rerender(
      <KnowledgeDocumentSearchResults
        snapshot={snapshot({ state: 'unavailable', results: [] })}
        results={[]}
        {...props}
      />,
    );
    expect(
      screen.getByText('This PDF has no searchable text. Relay does not run OCR.'),
    ).toBeInTheDocument();
  });

  it('reports failed pages without disabling successful matches', () => {
    const currentSnapshot = snapshot({ state: 'partial', failedPageIndices: [1, 4] });
    render(
      <KnowledgeDocumentSearchResults
        snapshot={currentSnapshot}
        results={displayResults(currentSnapshot)}
        enhancedUnavailable={false}
        activeResultIndex={-1}
        onActivate={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText('2 matches · 2 pages unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unavailable pages: 2, 5')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('button'),
    ).toHaveLength(2);
  });

  it('labels only fuzzy rows as close matches and announces enhanced unavailability compactly', () => {
    const currentSnapshot = snapshot({ results: [panelMatch(0)] });
    const fuzzy: KnowledgeDocumentSearchDisplayResult = {
      source: 'fuzzy',
      id: 'fuzzy:one',
      match: {
        id: 'one',
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        title: 'Guide',
        fileName: 'Guide.pdf',
        category: 'Operations',
        categoryId: null,
        documentType: 'sop',
        headingId: null,
        heading: 'Recovery',
        pageIndex: 4,
        passageNumber: 1,
        excerpt: 'Restart the failover service',
        matchKind: 'fuzzy',
        highlightText: 'failover',
        normalizedStart: 12,
        normalizedEnd: 20,
        score: 90,
      },
    };
    render(
      <KnowledgeDocumentSearchResults
        snapshot={currentSnapshot}
        results={[...displayResults(currentSnapshot), fuzzy]}
        enhancedUnavailable
        activeResultIndex={-1}
        onActivate={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('button'),
    ).toHaveLength(2);
    expect(screen.getByText('Close match')).toBeInTheDocument();
    expect(screen.getByText('Full-text close matches are unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Page 3/ })).not.toHaveTextContent('Close match');
  });

  it('keeps the active result visible as arrow navigation advances', () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const currentSnapshot = snapshot({
      results: Array.from({ length: 12 }, (_, index) => panelMatch(index)),
    });
    const results = displayResults(currentSnapshot);
    const props = {
      snapshot: currentSnapshot,
      results,
      enhancedUnavailable: false,
      onActivate: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    };

    try {
      const { rerender } = render(
        <KnowledgeDocumentSearchResults {...props} activeResultIndex={0} />,
      );
      scrollIntoView.mockClear();
      rerender(<KnowledgeDocumentSearchResults {...props} activeResultIndex={8} />);

      expect(
        within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('button')[8],
      ).toHaveAttribute('aria-current', 'location');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    }
  });

  it('returns the result list to its true top when navigation reaches the first match', () => {
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const currentSnapshot = snapshot({
      results: Array.from({ length: 12 }, (_, index) => panelMatch(index)),
    });
    const results = displayResults(currentSnapshot);
    const props = {
      snapshot: currentSnapshot,
      results,
      enhancedUnavailable: false,
      onActivate: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    };

    try {
      const { rerender } = render(
        <div className="knowledge-drawer__scroll">
          <KnowledgeDocumentSearchResults {...props} activeResultIndex={8} />
        </div>,
      );
      scrollTo.mockClear();
      scrollIntoView.mockClear();
      rerender(
        <div className="knowledge-drawer__scroll">
          <KnowledgeDocumentSearchResults {...props} activeResultIndex={0} />
        </div>,
      );

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
      }
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    }
  });

  it('pins match navigation above the scrolling result rows', () => {
    const currentSnapshot = snapshot();
    const { container } = render(
      <KnowledgeDocumentSearchResults
        snapshot={currentSnapshot}
        results={displayResults(currentSnapshot)}
        enhancedUnavailable={false}
        activeResultIndex={0}
        onActivate={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    const controls = container.querySelector('.knowledge-document-search__controls');
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Previous match' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Next match' }));
    expect(knowledgeStyles).toMatch(
      /\.knowledge-document-search__controls\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
    );
    expect(knowledgeStyles).toMatch(
      /\.knowledge-document-search__controls\s*\{[^}]*--knowledge-search-controls-bg:[^;]+;[^}]*box-shadow:\s*0\s+-4px\s+0\s+var\(--knowledge-search-controls-bg\);/s,
    );
  });
});
