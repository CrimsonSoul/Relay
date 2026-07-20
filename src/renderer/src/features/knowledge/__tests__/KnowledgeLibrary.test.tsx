import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeCategoryRecord, KnowledgeDocumentRecord } from '@shared/knowledge';
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeSearchResponse,
} from '@shared/knowledgeSearch';
import { KnowledgeLibrary } from '../KnowledgeLibrary';

const category: KnowledgeCategoryRecord = {
  id: 'category-operations',
  name: 'Operations',
  normalizedName: 'operations',
  sortOrder: 100,
  systemKey: '',
  revision: 1,
  created: '2026-07-18T12:00:00.000Z',
  updated: '2026-07-18T12:00:00.000Z',
};

function document(id: string, type: 'sop' | 'cheatsheet'): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `Operations/${id}.pdf`,
    category: 'Operations',
    categoryId: category.id,
    documentType: type,
    title: id,
    displayTitle: id === 'oracle' ? 'Oracle SOP Manual' : 'Oracle quick reference',
    fileName: `${id}.pdf`,
    pdf: `${id}.pdf`,
    cover: `${id}.png`,
    checksum: 'a'.repeat(64),
    byteSize: 100,
    pageCount: 12,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-18T12:00:00.000Z',
    indexedAt: '2026-07-18T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-18T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'owner',
    publishedByName: 'Ryan',
    publishedAt: '2026-07-18T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-18T12:00:00.000Z',
    updated: '2026-07-18T12:00:00.000Z',
  };
}

function passageResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    id: 'passage-1',
    documentId: 'oracle',
    checksum: 'a'.repeat(64),
    title: 'Oracle SOP Manual',
    fileName: 'oracle.pdf',
    category: 'Operations',
    categoryId: category.id,
    documentType: 'sop',
    headingId: 'failover',
    heading: 'Failover procedure',
    pageIndex: 6,
    passageNumber: 1,
    excerpt: 'Confirm the failover procedure before changing the primary database.',
    matchKind: 'fuzzy',
    highlightText: 'failover',
    normalizedStart: 42,
    normalizedEnd: 50,
    score: 90,
    ...overrides,
  };
}

function installSearch(
  resultsFor: (request: KnowledgeSearchRequest) => KnowledgeSearchResult[],
): ReturnType<typeof vi.fn> {
  const searchKnowledge = vi.fn(async (request: KnowledgeSearchRequest) => {
    const response: KnowledgeSearchResponse = {
      ok: true,
      requestId: request.requestId,
      availability: 'ready',
      normalizedQuery: request.query,
      results: resultsFor(request),
    };
    return response;
  });
  globalThis.api = { searchKnowledge, cancelKnowledgeSearch: vi.fn() } as never;
  return searchKnowledge;
}

async function finishDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

describe('KnowledgeLibrary', () => {
  beforeEach(() => {
    delete globalThis.api;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.api;
  });

  it('labels the catalog search by its Wiki scope and uses the shared search control', () => {
    render(
      <KnowledgeLibrary
        documents={[]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search Wiki' });
    expect(search).toHaveAttribute('placeholder', 'Search Wiki');
    expect(search).toHaveClass('scoped-search-input');
  });

  it('spotlights SOP covers, keeps cheatsheets compact, and opens the selected document', () => {
    const onOpenDocument = vi.fn();
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop'), document('quick', 'cheatsheet')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={onOpenDocument}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Recently updated' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SOP guides' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cheatsheets' })).toBeInTheDocument();
    expect(
      screen
        .getByRole('heading', { name: 'SOP guides' })
        .compareDocumentPosition(screen.getByRole('heading', { name: 'Cheatsheets' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Oracle quick reference/ })).toHaveTextContent(
      'Operations',
    );
    expect(screen.getByRole('button', { name: /Open Oracle quick reference/ })).toHaveTextContent(
      '12p',
    );
    expect(screen.getAllByRole('button', { name: /Open Oracle SOP Manual/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Open Oracle SOP Manual/ }));
    expect(onOpenDocument).toHaveBeenCalledWith({ documentId: 'oracle' });
  });

  it('switches to page-aware rows for an active query and restores covers immediately on clear', async () => {
    vi.useFakeTimers();
    installSearch(() => [passageResult()]);
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop'), document('quick', 'cheatsheet')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Search Wiki' });

    fireEvent.change(search, { target: { value: 'failvoer' } });
    await finishDebounce();

    expect(screen.getByRole('list', { name: 'Wiki search results' })).toBeVisible();
    expect(screen.getByText('Page 7')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'SOP guides' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });

    expect(screen.getByRole('heading', { name: 'SOP guides' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Cheatsheets' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Wiki search results' })).not.toBeInTheDocument();
  });

  it('retains category, type, and sort choices when the query clears', () => {
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop'), document('quick', 'cheatsheet')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Search Wiki' });
    const categorySelect = screen.getByRole('combobox', { name: 'Category' });
    const typeSelect = screen.getByRole('combobox', { name: 'Type' });
    const sortSelect = screen.getByRole('combobox', { name: 'Sort' });

    fireEvent.change(categorySelect, { target: { value: category.id } });
    fireEvent.change(typeSelect, { target: { value: 'cheatsheet' } });
    fireEvent.change(sortSelect, { target: { value: 'title' } });
    fireEvent.change(search, { target: { value: 'oracle' } });
    fireEvent.change(search, { target: { value: '' } });

    expect(categorySelect).toHaveValue(category.id);
    expect(typeSelect).toHaveValue('cheatsheet');
    expect(sortSelect).toHaveValue('title');
  });

  it('announces a changed local-only count once when an active type filter changes', () => {
    const sop = document('oracle', 'sop');
    sop.displayTitle = 'The Oracle SOP Manual';
    const cheatsheet = document('quick', 'cheatsheet');
    cheatsheet.displayTitle = 'The Oracle quick reference';
    render(
      <KnowledgeLibrary
        documents={[sop, cheatsheet]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'the' },
    });
    expect(screen.getByText('2 Wiki search results')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
      target: { value: 'sop' },
    });

    expect(screen.getByText('1 Wiki search result')).toBeInTheDocument();
    expect(screen.queryByText('2 Wiki search results')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open The Oracle/ })).toHaveLength(1);
  });

  it('keeps local metadata results interactive when enhanced search is unavailable', async () => {
    vi.useFakeTimers();
    const onOpenDocument = vi.fn();
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={onOpenDocument}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'oracle' },
    });
    await finishDebounce();

    expect(
      screen.getByText('Full-text search unavailable. Showing title and section matches.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Open Oracle SOP Manual.*page 1/i }));
    expect(onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'oracle', pageIndex: 0 }),
    );
  });

  it('passes active filters to enhanced search and removes duplicate document-page-range rows', async () => {
    vi.useFakeTimers();
    const searchKnowledge = installSearch(() => [
      passageResult({
        id: 'same-local-target',
        matchKind: 'exact',
        headingId: null,
        heading: null,
        pageIndex: 0,
        highlightText: 'oracle',
        normalizedStart: 0,
        normalizedEnd: 6,
      }),
    ]);
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: category.id },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
      target: { value: 'sop' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'oracle' },
    });
    await finishDebounce();

    expect(searchKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryId: category.id,
        documentType: 'sop',
        query: 'oracle',
      }),
    );
    expect(screen.getAllByRole('button', { name: /Open Oracle SOP Manual.*page 1/i })).toHaveLength(
      1,
    );
  });

  it('removes a settled prior-query passage row in the same commit as a query edit', async () => {
    vi.useFakeTimers();
    installSearch((request) => (request.query === 'failvoer' ? [passageResult()] : []));
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Search Wiki' });
    fireEvent.change(search, { target: { value: 'failvoer' } });
    await finishDebounce();
    expect(screen.getByText('Page 7')).toBeVisible();

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(search, 'oracle');
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(screen.queryByText('Page 7')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Oracle SOP Manual.*page 1/i })).toBeVisible();
  });
});
