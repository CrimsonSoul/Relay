import { createRef, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import type { KnowledgeSearchResult } from '@shared/knowledgeSearch';
import type { KnowledgeDocumentSearchMatch } from '../knowledgeDocumentSearch';
import { KnowledgeReaderSidebarBody } from '../KnowledgeReaderSidebarBody';
import type { KnowledgeDocumentSearchModel } from '../useKnowledgeDocumentSearch';

function exactMatch(): KnowledgeDocumentSearchMatch {
  return {
    id: '0:4:0',
    pageIndex: 0,
    matchIndex: 0,
    snippet: 'Use RF failover now',
    sectionLabel: 'Recovery',
    normalizedStart: 4,
    normalizedEnd: 6,
    textItemRange: { start: 0, end: 0 },
    domRange: {
      start: { itemIndex: 0, itemOffset: 4 },
      end: { itemIndex: 0, itemOffset: 6 },
    },
  };
}

function selectedDocument(): KnowledgeDocumentRecord {
  return {
    id: 'guide',
    displayTitle: 'Operations guide',
    category: 'Operations',
    pageCount: 3,
    documentType: 'sop',
  } as KnowledgeDocumentRecord;
}

describe('KnowledgeReaderSidebarBody', () => {
  it('hides a failed fuzzy generation from counts and controls, then recovers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exact = exactMatch();
    const onActivate = vi.fn();
    function Harness({
      generationKey,
      throwFuzzy,
    }: Readonly<{ generationKey: string; throwFuzzy: boolean }>) {
      const [hiddenGenerationKey, setHiddenGenerationKey] = useState<string | null>(null);
      const fuzzy = {
        id: 'fuzzy',
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        title: 'Operations guide',
        fileName: 'Operations guide.pdf',
        category: 'Operations',
        categoryId: null,
        documentType: 'sop',
        headingId: null,
        heading: 'Recovery',
        pageIndex: 1,
        passageNumber: 1,
        matchKind: 'fuzzy',
        highlightText: 'failover',
        normalizedStart: 4,
        normalizedEnd: 12,
        score: 90,
        get excerpt(): string {
          if (throwFuzzy) throw new Error('fuzzy row render failed');
          return 'Canonical failover procedure';
        },
      } satisfies KnowledgeSearchResult;
      const fuzzyVisible = hiddenGenerationKey !== generationKey;
      const results = [
        { source: 'local-exact' as const, id: `local:${exact.id}`, match: exact },
        ...(fuzzyVisible ? [{ source: 'fuzzy' as const, id: 'fuzzy:fuzzy', match: fuzzy }] : []),
      ];
      const contentsSearch = {
        query: 'rf',
        snapshot: {
          query: 'rf',
          normalizedQuery: 'rf',
          state: 'ready',
          results: [exact],
          completedPages: 3,
          totalPages: 3,
          failedPageIndices: [],
          searchablePageCount: 3,
        },
        results,
        highlightMatches: [exact],
        enhancedUnavailable: false,
        enhancedGenerationKey: generationKey,
        activeResultIndex: fuzzyVisible ? 1 : -1,
        activeResult: fuzzyVisible ? results[1] : null,
        navigationRequest: null,
        setQuery: vi.fn(),
        activateResult: async (index: number) => onActivate(index),
        activateNext: () => onActivate(fuzzyVisible ? 1 : 0),
        activatePrevious: vi.fn(),
        clear: vi.fn(),
        activateExternalTarget: vi.fn(async () => false),
        cancelExternalActivation: vi.fn(),
        hideEnhancedResults: setHiddenGenerationKey,
      } satisfies KnowledgeDocumentSearchModel;
      return (
        <KnowledgeReaderSidebarBody
          mode="contents"
          contentsTabRef={createRef<HTMLButtonElement>()}
          libraryTabRef={createRef<HTMLButtonElement>()}
          contentsSearchRef={createRef<HTMLInputElement>()}
          librarySearchRef={createRef<HTMLInputElement>()}
          contentsSearch={contentsSearch}
          libraryQuery=""
          groups={[]}
          documents={[selectedDocument()]}
          selectedDocument={selectedDocument()}
          activeHeadingId={null}
          shownCount={1}
          shownCategoryCount={1}
          indexState="idle"
          indexLabel="Indexed now"
          onModeChange={vi.fn()}
          onLibraryQueryChange={vi.fn()}
          onContentsEscape={vi.fn()}
          onSelectDocument={vi.fn()}
          onSelectHeading={vi.fn()}
        />
      );
    }

    const view = render(<Harness generationKey="generation-one" throwFuzzy />);

    expect(await screen.findAllByText('1 matches')).toHaveLength(2);
    let resultActions = within(screen.getByRole('list', { name: 'Matches' })).getAllByRole(
      'button',
    );
    expect(resultActions).toHaveLength(1);
    expect(resultActions[0]).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('Close match')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(onActivate).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search this guide' }), {
      key: 'Enter',
    });
    expect(onActivate).toHaveBeenLastCalledWith(0);

    view.rerender(<Harness generationKey="generation-two" throwFuzzy={false} />);

    expect(await screen.findByText('2 matches')).toBeVisible();
    resultActions = within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('button');
    expect(resultActions).toHaveLength(2);
    expect(resultActions[1]).toHaveAttribute('aria-current', 'location');
    expect(screen.getByText('Close match')).toBeVisible();
    consoleError.mockRestore();
  });
});
