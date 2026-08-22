import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import type { KnowledgeSearchResult } from '@shared/knowledgeSearch';
import { KnowledgePassageResultList } from '../KnowledgePassageResultList';

function document(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: 'oracle',
    sourceKey: 'Access/oracle.pdf',
    category: 'Access',
    categoryId: 'access',
    documentType: 'sop',
    title: 'Oracle recovery',
    displayTitle: 'Oracle recovery guide',
    fileName: 'oracle.pdf',
    pdf: 'oracle.pdf',
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1_024,
    pageCount: 12,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-19T12:00:00.000Z',
    indexedAt: '2026-07-19T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-19T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'owner',
    publishedByName: 'Ryan',
    publishedAt: '2026-07-19T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-19T12:00:00.000Z',
    updated: '2026-07-19T12:00:00.000Z',
    ...overrides,
  };
}

function result(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    id: 'result-1',
    documentId: 'oracle',
    checksum: 'a'.repeat(64),
    title: 'Oracle recovery guide',
    fileName: 'oracle.pdf',
    category: 'Access',
    categoryId: 'access',
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

describe('KnowledgePassageResultList', () => {
  beforeEach(() => {
    globalThis.api = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.api;
  });

  it('renders page-aware local and enhanced rows with fuzzy labels only where earned', () => {
    const localResult = result({ id: 'local', matchKind: 'exact', heading: null, headingId: null });
    const enhancedResult = result({ id: 'enhanced' });

    render(
      <KnowledgePassageResultList
        documentsById={new Map([['oracle', document()]])}
        localResults={[localResult]}
        enhancedResults={[enhancedResult]}
        loading={false}
        unavailable={false}
        searchIdentity="oracle:generation-1"
        settled
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole('list', { name: 'Wiki search results' })).toBeVisible();
    expect(screen.getAllByText('Oracle recovery guide')).toHaveLength(2);
    expect(screen.getByText('Document text')).toBeVisible();
    expect(screen.getByText('Failover procedure')).toBeVisible();
    expect(screen.getAllByText('Page 7')).toHaveLength(2);
    expect(screen.getAllByText('SOP Manual').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Close match')).toHaveLength(1);
  });

  it('opens a result with its complete page and canonical highlight target', () => {
    const onOpen = vi.fn();
    render(
      <KnowledgePassageResultList
        documentsById={new Map([['oracle', document()]])}
        localResults={[]}
        enhancedResults={[result()]}
        loading={false}
        unavailable={false}
        searchIdentity="failvoer:generation-1"
        settled
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open Oracle recovery guide.*page 7/i }));

    expect(onOpen).toHaveBeenCalledWith({
      documentId: 'oracle',
      headingId: 'failover',
      pageIndex: 6,
      highlightText: 'failover',
      normalizedStart: 42,
      normalizedEnd: 50,
    });
  });

  it('keeps local rows interactive with a compact enhanced-search notice', () => {
    const onOpen = vi.fn();
    render(
      <KnowledgePassageResultList
        documentsById={new Map([['oracle', document()]])}
        localResults={[result({ id: 'local', matchKind: 'exact' })]}
        enhancedResults={[]}
        loading={false}
        unavailable
        searchIdentity="oracle:generation-offline"
        settled
        onOpen={onOpen}
      />,
    );

    expect(
      screen.getByText('Full-text search unavailable. Showing title and section matches.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Open Oracle recovery guide.*page 7/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('excludes failed enhanced rows from the total and recovers on the next identity', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = new Proxy(result({ id: 'broken' }), {
      get(target, property, receiver) {
        if (property === 'documentId') throw new TypeError('enhanced row failed');
        return Reflect.get(target, property, receiver);
      },
    });

    const props = {
      documentsById: new Map([['oracle', document()]]) as ReadonlyMap<
        string,
        KnowledgeDocumentRecord
      >,
      localResults: [result({ id: 'local', matchKind: 'exact' })],
      loading: false,
      unavailable: false,
      settled: true,
      onOpen: vi.fn(),
    };
    const view = render(
      <KnowledgePassageResultList
        {...props}
        enhancedResults={[broken]}
        searchIdentity="oracle:generation-broken"
      />,
    );

    expect(
      screen.getByRole('button', { name: /Open Oracle recovery guide.*page 7/i }),
    ).toBeVisible();
    expect(
      screen.getByText('Full-text search unavailable. Showing title and section matches.'),
    ).toBeVisible();
    expect(screen.getByText('1 Wiki search result')).toBeInTheDocument();

    view.rerender(
      <KnowledgePassageResultList
        {...props}
        enhancedResults={[result({ id: 'healthy' })]}
        searchIdentity="oracle:generation-recovered"
      />,
    );

    expect(
      screen.queryByText('Full-text search unavailable. Showing title and section matches.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Close match')).toBeVisible();
    expect(screen.getByText('2 Wiki search results')).toBeInTheDocument();
  });

  it('announces an initial local-only settled identity', () => {
    const props = {
      documentsById: new Map([['oracle', document()]]) as ReadonlyMap<
        string,
        KnowledgeDocumentRecord
      >,
      localResults: [result({ id: 'local', matchKind: 'exact' })],
      enhancedResults: [result({ id: 'enhanced' })],
      unavailable: false,
      searchIdentity: 'local:oracle',
      onOpen: vi.fn(),
    };

    render(<KnowledgePassageResultList {...props} loading={false} settled />);

    expect(screen.getByText('2 Wiki search results')).toBeInTheDocument();
  });

  it('re-announces local-only idle query identities without retaining the prior count', () => {
    const props = {
      documentsById: new Map([['oracle', document()]]) as ReadonlyMap<
        string,
        KnowledgeDocumentRecord
      >,
      localResults: [result({ id: 'local', matchKind: 'exact' })],
      enhancedResults: [] as KnowledgeSearchResult[],
      loading: false,
      unavailable: false,
      settled: true,
      onOpen: vi.fn(),
    };
    const view = render(<KnowledgePassageResultList {...props} searchIdentity="local:oracle" />);
    const firstAnnouncement = screen.getByText('1 Wiki search result');

    view.rerender(<KnowledgePassageResultList {...props} searchIdentity="local:recovery" />);

    const secondAnnouncement = screen.getByText('1 Wiki search result');
    expect(secondAnnouncement).not.toBe(firstAnnouncement);

    view.rerender(<KnowledgePassageResultList {...props} searchIdentity="local:recovery" />);
    expect(screen.getByText('1 Wiki search result')).toBe(secondAnnouncement);
  });

  it('waits for a loading generation to settle before announcing', () => {
    const props = {
      documentsById: new Map([['oracle', document()]]) as ReadonlyMap<
        string,
        KnowledgeDocumentRecord
      >,
      localResults: [result({ id: 'local', matchKind: 'exact' })],
      enhancedResults: [result({ id: 'enhanced' })],
      unavailable: false,
      searchIdentity: 'failover:generation-1',
      onOpen: vi.fn(),
    };
    const view = render(<KnowledgePassageResultList {...props} loading settled={false} />);

    expect(screen.queryByText('2 Wiki search results')).not.toBeInTheDocument();
    view.rerender(<KnowledgePassageResultList {...props} loading={false} settled />);

    expect(screen.getByText('2 Wiki search results')).toBeInTheDocument();
  });

  it('re-announces the same count for a different settled query generation', () => {
    const props = {
      documentsById: new Map([['oracle', document()]]) as ReadonlyMap<
        string,
        KnowledgeDocumentRecord
      >,
      localResults: [result({ id: 'local', matchKind: 'exact' })],
      enhancedResults: [result({ id: 'enhanced' })],
      loading: false,
      unavailable: false,
      settled: true,
      onOpen: vi.fn(),
    };
    const view = render(
      <KnowledgePassageResultList {...props} searchIdentity="failover:generation-1" />,
    );
    const firstAnnouncement = screen.getByText('2 Wiki search results');

    view.rerender(
      <KnowledgePassageResultList
        {...props}
        searchIdentity="oracle:generation-2"
        settled={false}
      />,
    );
    expect(screen.queryByText('2 Wiki search results')).not.toBeInTheDocument();
    view.rerender(<KnowledgePassageResultList {...props} searchIdentity="oracle:generation-2" />);

    const secondAnnouncement = screen.getByText('2 Wiki search results');
    expect(secondAnnouncement).not.toBe(firstAnnouncement);
  });
});
