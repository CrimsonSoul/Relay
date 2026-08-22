import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { useKnowledgeLibrary } from '../useKnowledgeLibrary';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import type { KnowledgeDocumentSearchMatch } from '../knowledgeDocumentSearch';
import type { KnowledgeViewerTarget } from '../knowledgePdfDestination';
import { KnowledgeTab } from '../KnowledgeTab';
import type { KnowledgeSearchNavigationRequest } from '../useKnowledgeDocumentSearch';
import type { KnowledgePdfSession } from '../KnowledgePdfViewer';
import { useKnowledgePassageSearch } from '../useKnowledgePassageSearch';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn() }));
const privilegedAccessMocks = vi.hoisted(() => ({ usePrivilegedAccess: vi.fn() }));

vi.mock('../useKnowledgeLibrary', () => ({ useKnowledgeLibrary: vi.fn() }));
vi.mock('../useKnowledgePassageSearch', () => ({ useKnowledgePassageSearch: vi.fn() }));
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: toastMocks.showToast }),
}));
vi.mock('../../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: privilegedAccessMocks.usePrivilegedAccess,
}));
vi.mock('../KnowledgeManagementWorkspace', () => ({
  KnowledgeManagementWorkspace: ({ onExit }: { onExit: () => void }) => (
    <div>
      <span>Wiki management workspace</span>
      <button type="button" onClick={onExit}>
        Return to library
      </button>
    </div>
  ),
}));

const signedOutSession = {
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

type ViewerMockProps = {
  document: KnowledgeDocumentRecord | null;
  target: KnowledgeViewerTarget | null;
  currentSection?: string | null;
  focusRequestKey?: number;
  toolbarLeading?: ReactNode;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onDestinationChange: (target: KnowledgeViewerTarget) => void;
  onPageChange: (pageIndex: number) => void;
  onPdfSessionChange?: (session: KnowledgePdfSession | null) => void;
  searchNavigationRequest?: KnowledgeSearchNavigationRequest | null;
  searchMatches?: readonly KnowledgeDocumentSearchMatch[];
};

let latestViewerProps: ViewerMockProps | null = null;

const TEST_LINKS = [
  '#page=2',
  '#page=3',
  'Lane recovery.pdf#page=3',
  '../Access/Guide.pdf#page=2',
  'Missing.pdf',
  'Guide.pdf',
  'https://example.com/relay-guide',
] as const;

vi.mock('../KnowledgePdfViewer', () => ({
  KnowledgePdfViewer: (props: ViewerMockProps) => {
    latestViewerProps = props;
    const {
      document,
      target,
      currentSection,
      focusRequestKey,
      toolbarLeading,
      resolveUrl,
      onActivateResolvedLink,
      onDestinationChange,
    } = props;
    let targetLabel = '';
    if (target) {
      targetLabel = 'label' in target ? `at ${target.label}` : `at page ${target.pageIndex + 1}`;
    }
    return (
      <div>
        <div data-testid="viewer-toolbar-leading">{toolbarLeading}</div>
        <span>
          Viewer: {document?.title ?? 'none'} {targetLabel}
        </span>
        <span data-testid="viewer-document-id">{document?.id ?? 'none'}</span>
        <span data-testid="viewer-current-section">{currentSection ?? 'Document overview'}</span>
        <span data-testid="viewer-focus-key">{focusRequestKey ?? 'unset'}</span>
        <span data-testid="viewer-resolution">{JSON.stringify(resolveUrl('#page=2'))}</span>
        {TEST_LINKS.map((url) => (
          <button key={url} type="button" onClick={() => onActivateResolvedLink(resolveUrl(url))}>
            Activate {url}
          </button>
        ))}
        <button type="button" onClick={() => onDestinationChange({ pageIndex: 1, top: 601 })}>
          Follow native destination
        </button>
        <button
          type="button"
          onClick={() => onActivateResolvedLink({ kind: 'unavailable', reason: 'unsupported' })}
        >
          Report invalid native destination
        </button>
      </div>
    );
  },
}));

const useKnowledgeLibraryMock = vi.mocked(useKnowledgeLibrary);
const useKnowledgePassageSearchMock = vi.mocked(useKnowledgePassageSearch);

function document(
  id: string,
  title: string,
  category: string,
  checksum = 'a'.repeat(64),
): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `${category}/${title}.pdf`,
    category,
    categoryId: null,
    documentType: 'sop',
    title,
    fileName: `${title}.pdf`,
    pdf: `${title}.pdf`,
    cover: null,
    checksum,
    byteSize: 1024,
    pageCount: 3,
    outline: [
      { id: `${id}-heading`, label: 'Restart the lane service', level: 1, pageIndex: 1, top: 600 },
    ],
    outlineSource: 'native',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: checksum,
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    displayTitle: title,
    revision: 1,
    publishedByAccountId: '',
    publishedByName: '',
    publishedAt: '2026-07-14T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

// The Wiki always opens on the catalog, so reader coverage enters through the real affordance:
// the catalog card a user clicks to open a guide.
function openGuideFromCatalog(displayTitle: string): void {
  fireEvent.click(screen.getAllByRole('button', { name: `Open ${displayTitle}` })[0]!);
}

describe('KnowledgeTab', () => {
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    latestViewerProps = null;
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'idle',
      generationKey: '',
      response: null,
      error: null,
    });
    privilegedAccessMocks.usePrivilegedAccess.mockReturnValue({ session: signedOutSession });
    globalThis.api = {
      getKnowledgeIndexStatus: vi.fn(async () => ({
        state: 'idle',
        documentCount: 2,
        categoryCount: 2,
        lastIndexedAt: '2026-07-14T12:00:00.000Z',
      })),
      onKnowledgeIndexStatusChanged: vi.fn(() => unsubscribe),
      openKnowledgeWebLink: vi.fn(async () => ({ ok: true })),
      openExternal: vi.fn(async () => true),
    } as never;
  });

  afterEach(() => {
    delete globalThis.api;
  });

  it('pauses retained collection subscriptions while the Wiki is inactive', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: false,
      refetch: vi.fn(async () => undefined),
    });

    const view = render(<KnowledgeTab active={false} relayMode="client" />);
    expect(useKnowledgeLibraryMock).toHaveBeenLastCalledWith({
      enabled: false,
      retainSnapshotWhenDisabled: true,
    });

    view.rerender(<KnowledgeTab active relayMode="client" />);
    expect(useKnowledgeLibraryMock).toHaveBeenLastCalledWith({
      enabled: true,
      retainSnapshotWhenDisabled: true,
    });
  });

  it('reports the document count after a usable Wiki snapshot loads', async () => {
    const onLibraryCountChange = vi.fn();
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" onLibraryCountChange={onLibraryCountChange} />);

    await waitFor(() => expect(onLibraryCountChange).toHaveBeenLastCalledWith(2));
  });

  it('opens on the M3 Wiki catalog and enters the existing reader from a guide', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [
        {
          id: 'category-general',
          name: 'General',
          normalizedName: 'general',
          sortOrder: 100,
          systemKey: '',
          revision: 1,
          created: '2026-07-14T12:00:00.000Z',
          updated: '2026-07-14T12:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);
    expect(screen.getByRole('heading', { name: 'SOP Manuals' })).toBeInTheDocument();
    expect(screen.queryByText(/Viewer:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Operator guide' })[0]!);
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(latestViewerProps).toHaveProperty('searchNavigationRequest', null);
    expect(latestViewerProps).toHaveProperty('searchMatches', []);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Wiki' }));
    expect(screen.getByRole('heading', { name: 'SOP Manuals' })).toBeInTheDocument();
  });

  it('opens a catalog passage result at its requested page', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [
        {
          id: 'category-general',
          name: 'General',
          normalizedName: 'general',
          sortOrder: 100,
          systemKey: '',
          revision: 1,
          created: '2026-07-14T12:00:00.000Z',
          updated: '2026-07-14T12:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'catalog-generation',
      response: {
        ok: true,
        requestId: 'catalog-generation',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [
          {
            id: 'passage-1',
            documentId: 'guide',
            checksum: 'a'.repeat(64),
            title: 'Operator guide',
            fileName: 'Operator guide.pdf',
            category: 'General',
            categoryId: null,
            documentType: 'sop',
            headingId: 'guide-heading',
            heading: 'Restart the lane service',
            pageIndex: 2,
            passageNumber: 1,
            excerpt: 'Use the failover procedure.',
            matchKind: 'fuzzy',
            highlightText: 'failover',
            normalizedStart: 20,
            normalizedEnd: 28,
            score: 90,
          },
        ],
      },
      error: null,
    });
    render(<KnowledgeTab active relayMode="client" />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'failvoer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Operator guide.*page 3/i }));

    expect(screen.getByText(/Viewer: Operator guide at page 3/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-current-section')).toHaveTextContent(
      'Restart the lane service',
    );
  });

  it.each([
    ['NaN', Number.NaN, null],
    ['positive infinity', Number.POSITIVE_INFINITY, null],
    ['negative', -4, { pageIndex: 0, top: null }],
    ['past the document end', 99, { pageIndex: 2, top: null }],
  ] as const)('safely clamps a %s direct catalog page request', (_label, pageIndex, expected) => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [
        {
          id: 'category-general',
          name: 'General',
          normalizedName: 'general',
          sortOrder: 100,
          systemKey: '',
          revision: 1,
          created: '2026-07-14T12:00:00.000Z',
          updated: '2026-07-14T12:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'catalog-malformed',
      response: {
        ok: true,
        requestId: 'catalog-malformed',
        availability: 'ready',
        normalizedQuery: 'failover',
        results: [
          {
            id: 'passage-malformed',
            documentId: 'guide',
            checksum: 'a'.repeat(64),
            title: 'Operator guide',
            fileName: 'Operator guide.pdf',
            category: 'General',
            categoryId: null,
            documentType: 'sop',
            headingId: null,
            heading: null,
            pageIndex,
            passageNumber: 1,
            excerpt: 'Failover procedure.',
            matchKind: 'exact',
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
            score: 90,
          },
        ],
      },
      error: null,
    });
    render(<KnowledgeTab active relayMode="client" />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'failover' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Operator guide/ }));

    expect(latestViewerProps?.target).toEqual(expected);
  });

  it('reports an unavailable count before a usable snapshot and when loading fails', async () => {
    const onLibraryCountChange = vi.fn();
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: true,
      error: null,
      hasLoadedSnapshot: false,
      refetch: vi.fn(async () => undefined),
    });
    const view = render(
      <KnowledgeTab active relayMode="client" onLibraryCountChange={onLibraryCountChange} />,
    );
    await waitFor(() => expect(onLibraryCountChange).toHaveBeenLastCalledWith(null));

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: 'offline',
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    view.rerender(
      <KnowledgeTab active relayMode="client" onLibraryCountChange={onLibraryCountChange} />,
    );

    await waitFor(() => expect(onLibraryCountChange).toHaveBeenLastCalledWith(null));
  });

  it('renders the Wiki reader, filters by nested headings, and jumps to a selected heading', async () => {
    const laneGuide = document('lane', 'Lane recovery', 'Store systems');
    laneGuide.outline = [
      { id: 'lane-heading', label: 'Verify the printer', level: 1, pageIndex: 0, top: 700 },
    ];
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General'), laneGuide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);
    openGuideFromCatalog('Operator guide');

    expect(screen.getByRole('heading', { name: 'Operator guide' })).toBeInTheDocument();
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect(screen.getByText(/2 documents across 2 categories/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter library' }), {
      target: { value: 'lane service' },
    });
    expect(screen.getByRole('treeitem', { name: 'Operator guide' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'Lane recovery' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 matching across 1 category$/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('treeitem', { name: 'Restart the lane service, page 2' })[0]!,
    );
    expect(screen.getByText(/at Restart the lane service/)).toBeInTheDocument();
    expect(latestViewerProps?.target).toEqual(
      expect.objectContaining({ pageIndex: 1, top: null, label: 'Restart the lane service' }),
    );
    await waitFor(() => expect(globalThis.api?.getKnowledgeIndexStatus).toHaveBeenCalled());
  });

  it('starts the approved Wiki layout directly with its drawer and viewer', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    const drawer = screen.getByRole('complementary', { name: 'Wiki reader sidebar' });
    expect(within(drawer).getByRole('heading', { name: 'Operator guide' })).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Contents' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.queryByText('Find the guide, jump to the procedure, and stay in the flow.'),
    ).not.toBeInTheDocument();
  });

  it('uses document contents by default and keeps the full library behind a sidebar mode', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    const sidebar = screen.getByRole('complementary', { name: 'Wiki reader sidebar' });
    const contentsTab = within(sidebar).getByRole('tab', { name: 'Contents' });
    const libraryTab = within(sidebar).getByRole('tab', { name: 'Library' });

    expect(contentsTab).toHaveAttribute('aria-selected', 'true');
    expect(libraryTab).toHaveAttribute('aria-selected', 'false');
    expect(within(sidebar).getByText('General')).toBeInTheDocument();
    expect(within(sidebar).getByRole('heading', { name: 'Operator guide' })).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: 'Restart the lane service, page 2' }),
    ).toBeInTheDocument();
    expect(within(sidebar).queryByRole('searchbox', { name: 'Filter library' })).toBeNull();
    expect(within(sidebar).queryByRole('tree')).toBeNull();

    fireEvent.click(libraryTab);

    expect(contentsTab).toHaveAttribute('aria-selected', 'false');
    expect(libraryTab).toHaveAttribute('aria-selected', 'true');
    expect(within(sidebar).getByRole('searchbox', { name: 'Filter library' })).toHaveClass(
      'scoped-search-input',
    );
    fireEvent.click(within(sidebar).getByRole('treeitem', { name: 'Store systems, 1 document' }));
    fireEvent.click(within(sidebar).getByRole('treeitem', { name: 'Lane recovery' }));

    expect(screen.getByText(/Viewer: Lane recovery/)).toBeInTheDocument();
    expect(contentsTab).toHaveAttribute('aria-selected', 'true');
    expect(within(sidebar).queryByRole('searchbox', { name: 'Filter library' })).toBeNull();
    expect(within(sidebar).getByRole('heading', { name: 'Lane recovery' })).toBeInTheDocument();
    expect(within(sidebar).getByText('Store systems')).toBeInTheDocument();
  });

  it('controls the compact reader sidebar with focus-safe dismissal and selection', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    const workspace = screen.getByRole('region', { name: 'Wiki reader workspace' });
    expect(workspace.tagName).toBe('SECTION');
    const libraryToggle = screen.getByRole('button', { name: 'Wiki reader sidebar' });
    expect(screen.queryByRole('button', { name: 'Search this guide' })).not.toBeInTheDocument();
    expect(workspace).toHaveAttribute('data-library-drawer', 'closed');
    expect(libraryToggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(libraryToggle);

    expect(workspace).toHaveAttribute('data-library-drawer', 'open');
    expect(libraryToggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Contents' })).toHaveFocus());

    fireEvent.keyDown(globalThis.document, { key: 'Escape' });

    expect(workspace).toHaveAttribute('data-library-drawer', 'closed');
    expect(libraryToggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(libraryToggle).toHaveFocus());

    fireEvent.click(libraryToggle);
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Store systems, 1 document' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Lane recovery' }));

    expect(workspace).toHaveAttribute('data-library-drawer', 'closed');
    expect(screen.getByText(/Viewer: Lane recovery/)).toBeInTheDocument();
  });

  it('collapses the wide Wiki reader sidebar without changing compact drawer state', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    const workspace = screen.getByRole('region', { name: 'Wiki reader workspace' });
    expect(workspace).toHaveAttribute('data-library-collapsed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Wiki reader sidebar' }));

    const desktopRestore = screen.getByRole('button', { name: 'Show Wiki reader sidebar' });
    expect(workspace).toHaveAttribute('data-library-collapsed', 'true');
    await waitFor(() => expect(desktopRestore).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Wiki reader sidebar' }));
    expect(workspace).toHaveAttribute('data-library-drawer', 'open');
    expect(workspace).toHaveAttribute('data-library-collapsed', 'true');

    fireEvent.keyDown(globalThis.document, { key: 'Escape' });
    expect(workspace).toHaveAttribute('data-library-drawer', 'closed');
    expect(workspace).toHaveAttribute('data-library-collapsed', 'true');

    fireEvent.click(desktopRestore);
    expect(workspace).toHaveAttribute('data-library-collapsed', 'false');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Contents' })).toHaveFocus());
  });

  it('provides the viewer with pure URL resolution and accepts native destination targets', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    await waitFor(() =>
      expect(screen.getByTestId('viewer-resolution')).toHaveTextContent(
        JSON.stringify({ kind: 'same-document', pageIndex: 1 }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Follow native destination' }));
    expect(screen.getByText(/Viewer: Operator guide at page 2/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-current-section')).toHaveTextContent(
      'Restart the lane service',
    );
  });

  it('opens a unique linked PDF at the requested page and clears the drawer filter', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    const search = screen.getByRole('searchbox', { name: 'Filter library' });
    fireEvent.change(search, { target: { value: 'Operator' } });

    fireEvent.click(screen.getByRole('button', { name: 'Activate Lane recovery.pdf#page=3' }));

    expect(screen.getByTestId('viewer-document-id')).toHaveTextContent('lane');
    expect(screen.getByText(/Viewer: Lane recovery at page 3/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-current-section')).toHaveTextContent('Document section');
    expect(screen.getByTestId('viewer-focus-key')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect(screen.getByRole('searchbox', { name: 'Filter library' })).toHaveValue('');
  });

  it('follows a current-document page link without selecting or refocusing another guide', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    fireEvent.click(screen.getByRole('button', { name: 'Activate #page=2' }));

    expect(screen.getByTestId('viewer-document-id')).toHaveTextContent('guide');
    expect(screen.getByText(/Viewer: Operator guide at page 2/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-current-section')).toHaveTextContent(
      'Restart the lane service',
    );
    expect(screen.getByTestId('viewer-focus-key')).toHaveTextContent('0');
  });

  it('uses a relative authored path to open the correct duplicate category record', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('current', 'Current', '00 Source'),
        document('operations-guide', 'Guide', 'Operations'),
        document('access-guide', 'Guide', 'Access'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Current');

    fireEvent.click(screen.getByRole('button', { name: 'Activate ../Access/Guide.pdf#page=2' }));

    expect(screen.getByTestId('viewer-document-id')).toHaveTextContent('access-guide');
    expect(screen.getByText(/Viewer: Guide at page 2/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-focus-key')).toHaveTextContent('1');
  });

  it.each([
    ['Missing.pdf', 'Linked guide not found.'],
    [
      'Guide.pdf',
      'Multiple guides use this filename. Ask the document owner to qualify the category.',
    ],
  ])('reports unavailable link %s with approved copy and without IPC', (url, message) => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('current', 'Current', '00 Source'),
        document('operations-guide', 'Guide', 'Operations'),
        document('access-guide', 'Guide', 'Access'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Current');

    fireEvent.click(screen.getByRole('button', { name: `Activate ${url}` }));

    expect(toastMocks.showToast).toHaveBeenCalledWith(message, 'error');
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
  });

  it('reports an invalid native destination with approved copy and without IPC', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('current', 'Current', '00 Source')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Current');

    fireEvent.click(screen.getByRole('button', { name: 'Report invalid native destination' }));

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      'Relay blocked an unsupported document link.',
      'error',
    );
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /mailto:/i })).not.toBeInTheDocument();
  });

  it('opens a web link only through the dedicated API and only after activation', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Activate https://example.com/relay-guide' }),
    );

    await waitFor(() =>
      expect(globalThis.api?.openKnowledgeWebLink).toHaveBeenCalledWith(
        'https://example.com/relay-guide',
      ),
    );
    expect(globalThis.api?.openKnowledgeWebLink).toHaveBeenCalledTimes(1);
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
    expect(toastMocks.showToast).not.toHaveBeenCalled();
  });

  it('reports a failed dedicated web-open result', async () => {
    vi.mocked(globalThis.api!.openKnowledgeWebLink).mockResolvedValueOnce({
      ok: false,
      error: 'open-failed',
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    fireEvent.click(
      screen.getByRole('button', { name: 'Activate https://example.com/relay-guide' }),
    );

    await waitFor(() =>
      expect(toastMocks.showToast).toHaveBeenCalledWith(
        'Relay could not open this website in the system browser.',
        'error',
      ),
    );
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
  });

  it('does not activate resolved links during render, document selection, or status refresh', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Store systems, 1 document' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Lane recovery' }));
    const statusListener = vi.mocked(globalThis.api!.onKnowledgeIndexStatusChanged).mock
      .calls[0]![0];
    act(() => {
      statusListener({
        state: 'idle',
        documentCount: 2,
        categoryCount: 2,
        lastIndexedAt: '2026-07-14T12:05:00.000Z',
      });
    });

    expect(await screen.findByText(/Indexed Jul 14/i)).toBeInTheDocument();
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
    expect(toastMocks.showToast).not.toHaveBeenCalled();
  });

  it('does not let a stale resolved action reopen a document removed by realtime sync', () => {
    const guide = document('guide', 'Operator guide', 'General');
    const lane = document('lane', 'Lane recovery', 'Store systems');
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide, lane],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    const { rerender } = render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    const pendingLink = latestViewerProps!.resolveUrl('Lane recovery.pdf#page=2');
    const staleActivation = latestViewerProps!.onActivateResolvedLink;

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    rerender(<KnowledgeTab active relayMode="client" />);
    act(() => staleActivation(pendingLink));

    expect(screen.getByTestId('viewer-document-id')).toHaveTextContent('guide');
    expect(screen.queryByText(/Viewer: Lane recovery/)).not.toBeInTheDocument();
    expect(toastMocks.showToast).toHaveBeenCalledWith('Linked guide not found.', 'error');
  });

  it('routes an empty managed library through the designated publisher', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(screen.getByText(/no Wiki documents yet/i)).toBeInTheDocument();
    expect(screen.getByText(/designated Wiki publisher/i)).toBeInTheDocument();
    expect(screen.queryByText(/config data directory/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
    await waitFor(() => expect(globalThis.api?.getKnowledgeIndexStatus).toHaveBeenCalled());
  });

  it('describes account-based team publishing for an empty managed library', () => {
    privilegedAccessMocks.usePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-publisher',
        username: 'publisher',
        displayName: 'Knowledge Publisher',
        role: 'publisher',
        capabilities: ['knowledge.manage'],
        deviceId: 'device-1',
        expiresAt: null,
      },
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(
      screen.getByText(
        'Use the protected management workspace to stage and publish PDF guides for your Relay team.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/every Relay operator/i)).toBeNull();
  });

  it('labels the populated publisher entry point Manage Wiki', () => {
    privilegedAccessMocks.usePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-publisher',
        username: 'publisher',
        displayName: 'Knowledge Publisher',
        role: 'publisher',
        capabilities: ['knowledge.manage'],
        deviceId: 'device-1',
        expiresAt: null,
      },
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operations guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(screen.getByRole('button', { name: 'Manage Wiki' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage library' })).toBeNull();
  });

  it('returns from management to the same open guide and Contents query', async () => {
    privilegedAccessMocks.usePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-publisher',
        username: 'paris',
        displayName: 'Paris',
        role: 'publisher',
        capabilities: ['knowledge.manage'],
        deviceId: 'device-1',
        expiresAt: null,
      },
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="server" />);
    openGuideFromCatalog('Operator guide');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this guide' }), {
      target: { value: 'ticket escalation' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage Wiki' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to library' }));

    expect(await screen.findByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search this guide' })).toHaveValue(
      'ticket escalation',
    );
  });

  it('distinguishes a failed first index from an ordinary empty library', async () => {
    vi.mocked(globalThis.api!.getKnowledgeIndexStatus).mockResolvedValueOnce({
      state: 'error',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
      message: 'Knowledge source is unavailable',
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(await screen.findByRole('status')).toHaveTextContent('Knowledge source is unavailable');
  });

  it('opens a document selected from global search', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: { documentId: 'lane', headingId: 'lane-heading' },
        }),
      );
    });

    expect(
      screen.getByText(/Viewer: Lane recovery at Restart the lane service/),
    ).toBeInTheDocument();
  });

  it('resolves a page-aware global open request after the PDF session is ready', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 2,
            highlightText: 'failover',
            normalizedStart: 20,
            normalizedEnd: 28,
          },
        }),
      );
    });

    expect(screen.getByText(/Viewer: Operator guide at page 3/)).toBeInTheDocument();
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();

    const pdf = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({
          items: [
            {
              str: pageNumber === 3 ? 'Begin failover now' : '',
              hasEOL: false,
            },
          ],
          styles: {},
        }),
      })),
    } as unknown as PDFDocumentProxy;
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 1,
      });
    });

    await waitFor(() =>
      expect(latestViewerProps?.searchNavigationRequest?.result).toMatchObject({
        pageIndex: 2,
        normalizedStart: 6,
        normalizedEnd: 14,
      }),
    );
    expect(latestViewerProps?.searchMatches).toEqual([
      expect.objectContaining({ pageIndex: 2, normalizedStart: 6, normalizedEnd: 14 }),
    ]);
  });

  it('falls back to page-only navigation and announces unselectable passage text', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 1,
            highlightText: 'failover',
            normalizedStart: 6,
            normalizedEnd: 14,
          },
        }),
      );
    });
    const pdf = {
      numPages: 3,
      getPage: vi.fn(async () => ({
        getTextContent: async () => ({
          items: [{ str: 'No selectable target here', hasEOL: false }],
          styles: {},
        }),
      })),
    } as unknown as PDFDocumentProxy;
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 2,
      });
    });

    await waitFor(() =>
      expect(toastMocks.showToast).toHaveBeenCalledWith(
        'Match text was not selectable on this page.',
        'info',
      ),
    );
    expect(latestViewerProps?.target).toEqual({ pageIndex: 1, top: null });
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();
  });

  it.each([
    ['matching text', 'Begin failover now', 'd'],
    ['unselectable text', 'No selectable target here', 'e'],
  ])(
    'ignores a late external passage result after a user page change with %s',
    async (_label, pageText, checksumCharacter) => {
      const checksum = checksumCharacter.repeat(64);
      useKnowledgeLibraryMock.mockReturnValue({
        documents: [document('guide', 'Operator guide', 'General', checksum)],
        categories: [],
        loading: false,
        error: null,
        hasLoadedSnapshot: true,
        refetch: vi.fn(async () => undefined),
      });
      render(<KnowledgeTab active relayMode="client" />);
      openGuideFromCatalog('Operator guide');
      type DeferredTextContent = {
        items: Array<{ str: string; hasEOL: boolean }>;
        styles: Record<string, never>;
      };
      let resolveTextContent: ((content: DeferredTextContent) => void) | null = null;
      const textContent = new Promise<DeferredTextContent>((resolve) => {
        resolveTextContent = resolve;
      });
      const getPage = vi.fn(async () => ({
        getTextContent: () => textContent,
      }));
      act(() => {
        latestViewerProps?.onPdfSessionChange?.({
          pdf: { numPages: 3, getPage } as unknown as PDFDocumentProxy,
          documentId: 'guide',
          checksum,
          generation: 4,
        });
      });
      act(() => {
        globalThis.dispatchEvent(
          new CustomEvent('relay:open-knowledge-document', {
            detail: {
              documentId: 'guide',
              pageIndex: 2,
              highlightText: 'failover',
              normalizedStart: 6,
              normalizedEnd: 14,
            },
          }),
        );
      });
      await waitFor(() => expect(getPage).toHaveBeenCalledWith(3));

      act(() => latestViewerProps?.onPageChange(1));
      expect(latestViewerProps?.currentSection).toBe('Restart the lane service');

      await act(async () => {
        resolveTextContent?.({
          items: [{ str: pageText, hasEOL: false }],
          styles: {},
        });
        await textContent;
        await Promise.resolve();
      });

      expect(latestViewerProps?.currentSection).toBe('Restart the lane service');
      expect(latestViewerProps?.searchNavigationRequest).toBeNull();
      expect(latestViewerProps?.searchMatches).toEqual([]);
      expect(toastMocks.showToast).not.toHaveBeenCalledWith(
        'Match text was not selectable on this page.',
        'info',
      );
    },
  );

  it('ignores an old PDF session until the requested checksum session is ready', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 0,
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
          },
        }),
      );
    });
    const oldGetPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover old session', hasEOL: false }],
        styles: {},
      }),
    }));

    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: oldGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'b'.repeat(64),
        generation: 1,
      });
    });

    expect(oldGetPage).not.toHaveBeenCalled();
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();

    const readyGetPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover ready session', hasEOL: false }],
        styles: {},
      }),
    }));
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: readyGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 2,
      });
    });

    await waitFor(() => expect(readyGetPage).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(latestViewerProps?.searchNavigationRequest?.result).toMatchObject({ pageIndex: 0 }),
    );
  });

  it('cancels a passage captured for an older same-checksum session generation', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    const firstGetPage = vi.fn(async () => ({
      getTextContent: async () => ({ items: [], styles: {} }),
    }));
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: firstGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 1,
      });
    });
    const replacementGetPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover replacement session', hasEOL: false }],
        styles: {},
      }),
    }));

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 0,
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
          },
        }),
      );
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: replacementGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 2,
      });
    });

    expect(firstGetPage).not.toHaveBeenCalled();
    expect(replacementGetPage).not.toHaveBeenCalled();
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();
  });

  it('cancels a pending passage when the selected document checksum is replaced', () => {
    const original = document('guide', 'Operator guide', 'General', 'a'.repeat(64));
    const replacement = document('guide', 'Operator guide', 'General', 'b'.repeat(64));
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [original],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    const view = render(<KnowledgeTab active relayMode="client" />);
    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 0,
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
          },
        }),
      );
    });

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [replacement],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    view.rerender(<KnowledgeTab active relayMode="client" />);
    const replacementGetPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover replacement', hasEOL: false }],
        styles: {},
      }),
    }));
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: replacementGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'b'.repeat(64),
        generation: 2,
      });
    });

    expect(replacementGetPage).not.toHaveBeenCalled();
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();
  });

  it('cancels a pending passage after navigating away and reopening the same guide', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: {
            documentId: 'guide',
            pageIndex: 0,
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
          },
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back to Wiki' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Operator guide' })[0]!);
    const reopenedGetPage = vi.fn(async () => ({
      getTextContent: async () => ({
        items: [{ str: 'failover reopened', hasEOL: false }],
        styles: {},
      }),
    }));
    act(() => {
      latestViewerProps?.onPdfSessionChange?.({
        pdf: { numPages: 3, getPage: reopenedGetPage } as unknown as PDFDocumentProxy,
        documentId: 'guide',
        checksum: 'a'.repeat(64),
        generation: 3,
      });
    });

    expect(reopenedGetPage).not.toHaveBeenCalled();
    expect(latestViewerProps?.searchNavigationRequest).toBeNull();
  });

  it.each([
    ['NaN', Number.NaN, null],
    ['positive infinity', Number.POSITIVE_INFINITY, null],
    ['negative', -4, { pageIndex: 0, top: null }],
    ['past the document end', 99, { pageIndex: 2, top: null }],
  ] as const)('safely clamps a %s custom-event page request', (_label, pageIndex, expected) => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent('relay:open-knowledge-document', {
          detail: { documentId: 'guide', pageIndex },
        }),
      );
    });

    expect(latestViewerProps?.target).toEqual(expected);
  });

  it('keeps Contents search and Library filtering independent', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this guide' }), {
      target: { value: 'lane reset' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect(screen.getByRole('searchbox', { name: 'Filter library' })).toHaveValue('');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter library' }), {
      target: { value: 'operator' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
    expect(screen.getByRole('searchbox', { name: 'Search this guide' })).toHaveValue('lane reset');
  });

  it('opens Contents search with Cmd or Ctrl F and clears it with Escape', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));

    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    expect(screen.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true');
    const search = screen.getByRole('searchbox', { name: 'Search this guide' });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: 'reset' } });
    expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(search, { key: 'Enter', shiftKey: true })).toBe(false);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
  });

  it('restores the compact sidebar toggle after Escape from an empty Contents search', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    const toggle = screen.getByRole('button', { name: 'Wiki reader sidebar' });
    fireEvent.click(toggle);
    const search = screen.getByRole('searchbox', { name: 'Search this guide' });
    fireEvent.keyDown(search, { key: 'Escape' });

    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves the active guide across a transient unavailable library snapshot', () => {
    const guide = document('guide', 'Operator guide', 'General');
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    const view = render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: true,
      error: null,
      hasLoadedSnapshot: false,
      refetch: vi.fn(async () => undefined),
    });
    view.rerender(<KnowledgeTab active relayMode="client" />);
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    view.rerender(<KnowledgeTab active relayMode="client" />);

    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(screen.queryByText(/was removed/i)).not.toBeInTheDocument();
  });

  it('keeps the reader when authoritative removal confirmation fails', async () => {
    const guide = document('guide', 'Operator guide', 'General');
    const refetch = vi.fn(async () => {
      throw new Error('offline');
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch,
    });
    const view = render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch,
    });
    view.rerender(<KnowledgeTab active relayMode="client" />);

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(screen.queryByText(/was removed/i)).not.toBeInTheDocument();
  });

  it('returns to the SOP catalog without a sticky notice when an active guide is removed', async () => {
    const guide = document('guide', 'Operator guide', 'General');
    const lane = document('lane', 'Lane recovery', 'Store systems');
    const refetch = vi.fn(async () => undefined);
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide, lane],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch,
    });
    const { rerender } = render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Store systems, 1 document' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Lane recovery' }));

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch,
    });
    rerender(<KnowledgeTab active relayMode="client" />);

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: 'SOP Manuals' })).toBeInTheDocument();
    expect(screen.queryByText(/Lane recovery.*removed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Viewer: Operator guide/)).not.toBeInTheDocument();
  });

  it('surfaces server index warnings in the library footer', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="server" />);
    openGuideFromCatalog('Operator guide');
    const statusListener = vi.mocked(globalThis.api!.onKnowledgeIndexStatusChanged).mock
      .calls[0]![0];

    act(() => {
      statusListener({
        state: 'warning',
        documentCount: 1,
        categoryCount: 1,
        lastIndexedAt: '2026-07-14T12:00:00.000Z',
        message: 'Knowledge index completed with warnings',
      });
    });

    expect(await screen.findByText('Knowledge index completed with warnings')).toBeInTheDocument();
  });

  it('uses document metadata freshness when client index status has no timestamp', async () => {
    vi.mocked(globalThis.api!.getKnowledgeIndexStatus).mockResolvedValueOnce({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    expect(await screen.findByText(/Indexed Jul 14/i)).toBeInTheDocument();
    expect(screen.queryByText('Waiting for first index')).not.toBeInTheDocument();
  });

  it('keeps the library usable when index status is temporarily unavailable', async () => {
    vi.mocked(globalThis.api!.getKnowledgeIndexStatus).mockRejectedValueOnce(
      new Error('status unavailable'),
    );
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      categories: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);
    openGuideFromCatalog('Operator guide');

    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    await waitFor(() => expect(globalThis.api?.getKnowledgeIndexStatus).toHaveBeenCalled());
  });
});
