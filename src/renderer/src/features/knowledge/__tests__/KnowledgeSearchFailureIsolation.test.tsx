import { createRef, useMemo, useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { KnowledgeCategoryRecord, KnowledgeDocumentRecord } from '@shared/knowledge';
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
} from '@shared/knowledgeSearch';
import { HeaderSearch, type HeaderSearchActions } from '../../../components/HeaderSearch';
import { ToastProvider } from '../../../components/Toast';
import { NotesProvider, SearchProvider, useNotesContext } from '../../../contexts';
import { KnowledgeLibrary } from '../KnowledgeLibrary';
import { KnowledgeManagementWorkspace } from '../KnowledgeManagementWorkspace';
import { KnowledgeReaderSidebarBody } from '../KnowledgeReaderSidebarBody';
import { KnowledgeWorkspace } from '../KnowledgeWorkspace';
import { KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY } from '../knowledgeWorkspaceNavigation';
import type { KnowledgeOpenRequest } from '../knowledgeNavigation';
import type {
  KnowledgeDocumentSearchMatch,
  KnowledgeDocumentSearchSnapshot,
} from '../knowledgeDocumentSearch';
import type { KnowledgePdfSession } from '../KnowledgePdfViewer';
import {
  useKnowledgeDocumentSearch,
  type KnowledgeDocumentSearchControllerFactory,
} from '../useKnowledgeDocumentSearch';
import { useKnowledgeManagement } from '../useKnowledgeManagement';

const testState = vi.hoisted(() => ({
  throwKnowledgeIcon: false,
  throwFuzzyRows: false,
  throwCoverDocumentId: null as string | null,
  commandResults: [] as Array<Record<string, unknown>>,
  refetchNotes: vi.fn(async () => undefined),
}));

vi.mock('../../../hooks/useCollection', () => ({
  useCollection: () => ({
    data: [
      {
        id: 'contact-note-1',
        entityType: 'contact',
        entityKey: 'operator@example.com',
        note: 'Primary failover owner',
        tags: ['critical'],
        created: '2026-07-19T12:00:00.000Z',
        updated: '2026-07-19T12:00:00.000Z',
      },
      {
        id: 'server-note-1',
        entityType: 'server',
        entityKey: 'failover-server-1',
        note: 'Validated recovery host',
        tags: ['recovery'],
        created: '2026-07-19T12:00:00.000Z',
        updated: '2026-07-19T12:00:00.000Z',
      },
    ],
    loading: false,
    error: null,
    hasLoadedSnapshot: true,
    refetch: testState.refetchNotes,
  }),
}));
vi.mock('../../../hooks/useCommandSearch', () => ({
  useCommandSearch: () => testState.commandResults,
}));
vi.mock('../useKnowledgeLibrary', () => ({ useKnowledgeLibrary: () => ({ documents: [] }) }));
vi.mock('../../../components/command-palette/CommandIcons', () => ({
  ContactIcon: () => <span data-testid="contact-icon" />,
  GroupIcon: () => <span data-testid="group-icon" />,
  ServerIcon: () => <span data-testid="server-icon" />,
  KnowledgeIcon: () => {
    if (testState.throwKnowledgeIcon) throw new TypeError('enhanced-header-render-failed');
    return <span data-testid="knowledge-icon" />;
  },
  ActionIcon: () => <span data-testid="action-icon" />,
}));
vi.mock('../useKnowledgeCover', () => ({
  useKnowledgeCover: ({ documentId }: { documentId: string }) => {
    if (testState.throwCoverDocumentId === documentId) {
      throw new TypeError('enhanced-cover-render-failed');
    }
    return {
      ref: { current: null },
      state: 'idle',
      url: null,
      onImageLoad: vi.fn(),
      onImageError: vi.fn(),
    };
  },
}));
vi.mock('../KnowledgeDocumentSearchResults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../KnowledgeDocumentSearchResults')>();
  return {
    ...actual,
    KnowledgeDocumentSearchFuzzyResults: (
      props: Parameters<typeof actual.KnowledgeDocumentSearchFuzzyResults>[0],
    ) => {
      if (testState.throwFuzzyRows) throw new TypeError('enhanced-reader-render-failed');
      return <actual.KnowledgeDocumentSearchFuzzyResults {...props} />;
    },
  };
});
vi.mock('../../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    ui: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  },
}));
vi.mock('../useKnowledgeManagement', () => ({ useKnowledgeManagement: vi.fn() }));

const useKnowledgeManagementMock = vi.mocked(useKnowledgeManagement);
const category: KnowledgeCategoryRecord = {
  id: 'operations',
  name: 'Operations',
  normalizedName: 'operations',
  sortOrder: 100,
  systemKey: '',
  revision: 1,
  created: '2026-07-19T12:00:00.000Z',
  updated: '2026-07-19T12:00:00.000Z',
};

function document(id: string, title: string): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `Operations/${id}.pdf`,
    category: 'Operations',
    categoryId: category.id,
    documentType: 'sop',
    title,
    displayTitle: title,
    fileName: `${id}.pdf`,
    pdf: `${id}.pdf`,
    cover: `${id}.png`,
    checksum: 'a'.repeat(64),
    byteSize: 100,
    pageCount: 3,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-19T12:00:00.000Z',
    indexedAt: '2026-07-19T12:00:00.000Z',
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'owner',
    publishedByName: 'Operator',
    publishedAt: '2026-07-19T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-19T12:00:00.000Z',
    searchIndexError: null,
    created: '2026-07-19T12:00:00.000Z',
    updated: '2026-07-19T12:00:00.000Z',
  };
}

const oracleDocument = document('oracle', 'Oracle SOP Manual');
const networkDocument = document('network', 'Network recovery guide');

const workspaceContact = {
  id: 'contact-1',
  name: 'Failover Operator',
  email: 'operator@example.com',
  phone: '555-0100',
  title: 'Incident commander',
  company: 'Relay',
  department: 'Operations',
  location: 'Chicago',
  _searchString: 'failover operator operator@example.com',
  raw: { id: 'contact-1' },
};
const workspaceGroup = {
  id: 'group-1',
  name: 'Operations',
  contacts: [workspaceContact.email],
};
const workspaceServer = {
  id: 'server-1',
  name: 'failover-server-1',
  owner: workspaceContact.email,
  contact: workspaceContact.email,
  os: 'Linux',
  businessArea: 'Operations',
  lob: 'Reliability',
  comment: 'Primary failover host',
  _searchString: 'failover-server-1 linux operations',
  raw: { id: 'server-1' },
};

function passageResult(
  id = 'passage-1',
  overrides: Partial<KnowledgeSearchResult> = {},
): KnowledgeSearchResult {
  return {
    id,
    documentId: 'oracle',
    checksum: 'a'.repeat(64),
    title: 'Oracle SOP Manual',
    fileName: 'oracle.pdf',
    category: 'Operations',
    categoryId: category.id,
    documentType: 'sop',
    headingId: 'failover',
    heading: 'Failover procedure',
    pageIndex: 1,
    passageNumber: 1,
    excerpt: 'Confirm the failover procedure before changing the primary database.',
    matchKind: 'fuzzy',
    highlightText: 'failover',
    normalizedStart: 12,
    normalizedEnd: 20,
    score: 90,
    ...overrides,
  };
}

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

function controllerFactory(): KnowledgeDocumentSearchControllerFactory {
  let listener: ((snapshot: KnowledgeDocumentSearchSnapshot) => void) | null = null;
  let query = '';
  const snapshot = (): KnowledgeDocumentSearchSnapshot => ({
    query,
    normalizedQuery: query,
    state: query ? 'ready' : 'idle',
    results: query ? [exactMatch()] : [],
    completedPages: 3,
    totalPages: 3,
    failedPageIndices: [],
    searchablePageCount: 3,
  });
  const controller = {
    subscribe: vi.fn((next: (value: KnowledgeDocumentSearchSnapshot) => void) => {
      listener = next;
      return vi.fn();
    }),
    getSnapshot: vi.fn(snapshot),
    setQuery: vi.fn((next: string) => {
      query = next;
      listener?.(snapshot());
    }),
    setCurrentPage: vi.fn(),
    resolveExternalMatch: vi.fn(async () => null),
    dispose: vi.fn(),
  };
  return () => controller;
}

function ReaderHarness() {
  const session = useMemo<KnowledgePdfSession>(
    () => ({
      pdf: { numPages: 3 } as PDFDocumentProxy,
      documentId: oracleDocument.id,
      checksum: oracleDocument.checksum,
      generation: 1,
    }),
    [],
  );
  const factory = useMemo(() => controllerFactory(), []);
  const contentsSearch = useKnowledgeDocumentSearch(session, [], 0, factory);
  return (
    <section aria-label="Reader sentinel">
      <KnowledgeReaderSidebarBody
        mode="contents"
        contentsTabRef={createRef<HTMLButtonElement>()}
        libraryTabRef={createRef<HTMLButtonElement>()}
        contentsSearchRef={createRef<HTMLInputElement>()}
        librarySearchRef={createRef<HTMLInputElement>()}
        contentsSearch={contentsSearch}
        libraryQuery=""
        groups={[]}
        documents={[oracleDocument]}
        selectedDocument={oracleDocument}
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
      <output data-testid="reader-navigation">
        {contentsSearch.navigationRequest?.result.id ?? 'none'}
      </output>
    </section>
  );
}

function ProductionDestinationHarness() {
  return (
    <KnowledgeWorkspace
      active
      contacts={[workspaceContact] as never}
      groups={[workspaceGroup] as never}
      servers={[workspaceServer] as never}
      relayMode="server"
      onAddToAssembler={vi.fn()}
    />
  );
}

function NotesLifecycleProbe() {
  const { getContactNote, getServerNote, reloadNotes } = useNotesContext();
  return (
    <section aria-label="Notes provider lifecycle">
      <output>{getContactNote(workspaceContact.email)?.note ?? 'No contact note'}</output>
      <output>{getServerNote(workspaceServer.name)?.note ?? 'No server note'}</output>
      <button type="button" onClick={() => void reloadNotes()}>
        Refresh notes
      </button>
    </section>
  );
}

function managementModel() {
  return {
    canManage: true,
    snapshot: {
      mode: 'managed',
      categories: [category],
      documents: {
        items: [
          {
            id: oracleDocument.id,
            checksum: oracleDocument.checksum,
            category: oracleDocument.category,
            categoryId: oracleDocument.categoryId,
            documentType: oracleDocument.documentType,
            displayTitle: oracleDocument.displayTitle,
            fileName: oracleDocument.fileName,
            byteSize: oracleDocument.byteSize,
            pageCount: oracleDocument.pageCount,
            lifecycleState: 'active',
            revision: 1,
            publishedByName: 'Operator',
            publishedAt: oracleDocument.publishedAt,
            trashedByName: null,
            trashedAt: null,
            searchIndexState: 'ready',
            searchIndexChecksum: oracleDocument.checksum,
            searchIndexVersion: 1,
            searchIndexedAt: oracleDocument.searchIndexedAt,
            searchIndexError: null,
            updated: oracleDocument.updated,
          },
        ],
        nextCursor: null,
      },
      uploads: { items: [], nextCursor: null },
      trash: { items: [], nextCursor: null },
    },
    auditEvents: [],
    auditNextCursor: null,
    loading: false,
    busy: null,
    uploadQueue: {
      restartRecovery: false,
      activeBatchId: null,
      totalBytes: 0,
      acknowledgedBytes: 0,
      items: [],
    },
    error: null,
    refresh: vi.fn(),
    readAudit: vi.fn(),
    loadMoreAudit: vi.fn(),
    loadMore: vi.fn(),
    stagePdfs: vi.fn(async () => ({ ok: true, uploads: [] })),
    pauseUploadBatch: vi.fn(),
    resumeUploadBatch: vi.fn(),
    retryUpload: vi.fn(),
    reselectUploadSource: vi.fn(),
    cancelUpload: vi.fn(),
    cancelUploadBatch: vi.fn(),
    clearError: vi.fn(),
    retrySearchIndex: vi.fn(),
    publish: vi.fn(),
    replace: vi.fn(),
    setTitle: vi.fn(),
    setCategory: vi.fn(),
    renameCategory: vi.fn(),
    createCategory: vi.fn(),
    setCategoryName: vi.fn(),
    setCategoryOrder: vi.fn(),
    deleteCategory: vi.fn(),
    setDocumentMetadata: vi.fn(),
    assignDocumentCategories: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    deletePermanently: vi.fn(),
  };
}

type RendererFault = 'missing-api' | 'rejected-ipc' | 'timeout' | 'cancellation' | 'malformed';

function installFault(fault: RendererFault): void {
  if (fault === 'missing-api') {
    delete globalThis.api;
    return;
  }
  globalThis.api = {
    searchKnowledge: vi.fn(async (request: KnowledgeSearchRequest) => {
      if (fault === 'rejected-ipc') throw new Error('ipc-rejected');
      if (fault === 'malformed') return { bad: 'response' } as never;
      if (fault === 'timeout') {
        return { ok: false, requestId: request.requestId, error: 'timeout' };
      }
      return { ok: false, requestId: request.requestId, error: 'cancelled' };
    }),
    cancelKnowledgeSearch: vi.fn(),
    platform: 'darwin',
  } as never;
}

function successfulApi(results: KnowledgeSearchResult[]): void {
  globalThis.api = {
    searchKnowledge: vi.fn(
      async (request: KnowledgeSearchRequest) =>
        ({
          ok: true,
          requestId: request.requestId,
          availability: 'ready',
          normalizedQuery: request.query,
          results,
        }) satisfies KnowledgeSearchResponse,
    ),
    cancelKnowledgeSearch: vi.fn(),
    platform: 'darwin',
  } as never;
}

/** Fresh spies per case, so one case's calls never leak into the next one's assertions. */
function makeHeaderActions(): HeaderSearchActions {
  return {
    onAddContactToBridge: vi.fn(),
    onToggleGroup: vi.fn(),
    onNavigateToTab: vi.fn(),
    onOpenKnowledgeDestination: vi.fn(),
    onOpenKnowledgeRecord: vi.fn(),
    onOpenAddContact: vi.fn(),
    onOpenKnowledgeDocument: vi.fn(),
  };
}

let activeManagement: ReturnType<typeof managementModel>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;
let hadOwnScrollIntoView = false;

async function settleSearches(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(500));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  testState.throwKnowledgeIcon = false;
  testState.throwFuzzyRows = false;
  testState.throwCoverDocumentId = null;
  testState.commandResults = [
    {
      id: 'contact-1',
      type: 'contact',
      title: 'Failover Operator',
      subtitle: 'operator@example.com',
      data: { id: 'contact-1', name: 'Failover Operator', email: 'operator@example.com' },
    },
    {
      id: 'server-1',
      type: 'server',
      title: 'Failover Server',
      data: { id: 'server-1', name: 'Failover Server' },
    },
    {
      id: 'action-1',
      type: 'action',
      title: 'Open alerts',
      iconType: 'navigate',
      data: { action: 'navigate', tab: 'Alerts' },
    },
  ];
  activeManagement = managementModel();
  useKnowledgeManagementMock.mockReturnValue(activeManagement as never);
  localStorage.removeItem(KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY);
  hadOwnScrollIntoView = Object.prototype.hasOwnProperty.call(Element.prototype, 'scrollIntoView');
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.api;
  localStorage.removeItem(KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY);
  if (hadOwnScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: originalScrollIntoView,
    });
  } else {
    delete (Element.prototype as Partial<Element>)['scrollIntoView'];
  }
});

function ProductionSurfaceHarness({
  headerActions,
  onOpenDocument,
}: Readonly<{
  headerActions: HeaderSearchActions;
  onOpenDocument: MockedFunction<(request: KnowledgeOpenRequest) => void>;
}>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <ToastProvider>
      <NotesProvider>
        <SearchProvider activeTab="Wiki" searchInputRef={searchInputRef}>
          <HeaderSearch
            activeTab="Wiki"
            contacts={[workspaceContact] as never}
            servers={[workspaceServer] as never}
            groups={[workspaceGroup] as never}
            actions={headerActions}
          />
          <KnowledgeLibrary
            documents={[oracleDocument, networkDocument]}
            categories={[category]}
            canManage
            onManage={vi.fn()}
            onOpenDocument={onOpenDocument}
          />
          <ReaderHarness />
          <KnowledgeManagementWorkspace onExit={vi.fn()} />
          <ProductionDestinationHarness />
          <NotesLifecycleProbe />
        </SearchProvider>
      </NotesProvider>
    </ToastProvider>
  );
}

async function assertCoreProductionSurfaces(
  headerActions: HeaderSearchActions,
  onOpenDocument: MockedFunction<(request: KnowledgeOpenRequest) => void>,
): Promise<void> {
  const headerInput = screen.getByRole('combobox', { name: 'Search Relay' });
  for (const label of ['Failover Operator', 'Failover Server']) {
    act(() => headerInput.focus());
    expect(headerInput).toHaveFocus();
    fireEvent.change(headerInput, { target: { value: 'failover' } });
    await settleSearches();
    const headerDropdown = screen.getByRole('listbox', { name: '' });
    expect(within(headerDropdown).getByText(label)).toBeVisible();
    fireEvent.click(within(headerDropdown).getByText(label).closest('button')!);
    await settleSearches();
    expect(headerInput).toHaveValue('failover');
    expect(headerInput).not.toHaveFocus();
    expect(screen.queryByRole('listbox', { name: '' })).not.toBeInTheDocument();
    fireEvent.change(headerInput, { target: { value: '' } });
  }

  act(() => headerInput.focus());
  fireEvent.change(headerInput, { target: { value: 'failover' } });
  await settleSearches();
  const headerDropdown = screen.getByRole('listbox', { name: '' });
  fireEvent.click(within(headerDropdown).getByText('Open alerts').closest('button')!);
  await settleSearches();
  expect(headerInput).toHaveValue('');
  expect(headerInput).not.toHaveFocus();

  expect(headerActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
    destination: 'contacts',
    recordKey: 'email:operator@example.com',
  });
  expect(headerActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
    destination: 'servers',
    recordKey: 'name:failover server',
  });
  expect(headerActions.onAddContactToBridge).not.toHaveBeenCalled();
  expect(headerActions.onNavigateToTab).toHaveBeenCalledWith('Alerts');

  const localCatalogResult = screen.getByRole('button', {
    name: /Open Oracle SOP Manual.*page 1/i,
  });
  expect(localCatalogResult).toBeVisible();
  fireEvent.click(localCatalogResult);
  expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'oracle' }));

  const reader = screen.getByRole('region', { name: 'Reader sentinel' });
  const exact = within(reader).getByRole('button', { name: /Use RF failover now/ });
  expect(exact).toBeVisible();
  fireEvent.click(exact);
  expect(screen.getByTestId('reader-navigation')).toHaveTextContent(exactMatch().id);

  expect(screen.getByRole('heading', { name: 'Manage Wiki' })).toBeVisible();
  expect(screen.getByText('Search ready')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
  expect(activeManagement.stagePdfs).toHaveBeenCalledTimes(1);

  const notesLifecycle = screen.getByRole('region', { name: 'Notes provider lifecycle' });
  expect(within(notesLifecycle).getByText('Primary failover owner')).toBeVisible();
  expect(within(notesLifecycle).getByText('Validated recovery host')).toBeVisible();
  fireEvent.click(within(notesLifecycle).getByRole('button', { name: 'Refresh notes' }));
  expect(testState.refetchNotes).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
  fireEvent.click(screen.getByRole('button', { name: /Open Contacts, 1 contact/ }));
  const contactsPanel = globalThis.document.querySelector<HTMLElement>(
    '[data-knowledge-panel][data-destination="contacts"]',
  );
  expect(contactsPanel).toHaveAttribute('data-state', 'active');
  expect(
    await within(contactsPanel!).findByRole('searchbox', { name: 'Filter contacts' }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Servers' }));
  const serversPanel = globalThis.document.querySelector<HTMLElement>(
    '[data-knowledge-panel][data-destination="servers"]',
  );
  expect(serversPanel).toHaveAttribute('data-state', 'active');
  expect(
    await within(serversPanel!).findByRole('searchbox', { name: 'Filter servers' }),
  ).toBeVisible();
  expect(contactsPanel).toBeInTheDocument();
}

describe('Wiki search renderer degraded-mode release gate', () => {
  it.each(['missing-api', 'rejected-ipc', 'timeout', 'cancellation', 'malformed'] as const)(
    'contains %s while core destinations remain usable',
    async (fault) => {
      installFault(fault);
      const headerActions = makeHeaderActions();
      const onOpenDocument = vi.fn<(request: KnowledgeOpenRequest) => void>();
      render(
        <ProductionSurfaceHarness headerActions={headerActions} onOpenDocument={onOpenDocument} />,
      );

      expect(screen.getByRole('button', { name: /Open Oracle SOP Manual/ })).toBeVisible();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
        target: { value: 'oracle' },
      });
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search this guide' }), {
        target: { value: 'rf' },
      });
      await settleSearches();
      await assertCoreProductionSurfaces(headerActions, onOpenDocument);
    },
  );

  it.each(['header', 'catalog', 'reader', 'catalog-boundary-recovery'] as const)(
    'contains the %s production render boundary while every core surface stays actionable',
    async (boundary) => {
      successfulApi([
        passageResult(),
        passageResult('network-passage', {
          documentId: networkDocument.id,
          title: networkDocument.displayTitle,
          fileName: networkDocument.fileName,
        }),
      ]);
      testState.throwKnowledgeIcon = boundary === 'header';
      testState.throwFuzzyRows = boundary === 'reader';
      const faultCatalogBoundary = boundary.startsWith('catalog');
      testState.throwCoverDocumentId = null;
      const headerActions = makeHeaderActions();
      const onOpenDocument = vi.fn<(request: KnowledgeOpenRequest) => void>();
      render(
        <ProductionSurfaceHarness headerActions={headerActions} onOpenDocument={onOpenDocument} />,
      );
      const catalogSearch = screen.getByRole('searchbox', { name: 'Search Wiki' });
      fireEvent.change(catalogSearch, { target: { value: 'oracle' } });
      if (faultCatalogBoundary) testState.throwCoverDocumentId = networkDocument.id;
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search this guide' }), {
        target: { value: 'rf' },
      });
      await settleSearches();

      if (boundary.startsWith('catalog')) {
        expect(screen.getByText(/Full-text search unavailable/)).toBeVisible();
      }
      if (boundary === 'catalog-boundary-recovery') {
        testState.throwCoverDocumentId = null;
        fireEvent.change(catalogSearch, { target: { value: 'oracle recovery' } });
        await settleSearches();
        expect(
          screen.getByRole('button', {
            name: /Open Network recovery guide.*page 2/i,
          }),
        ).toBeVisible();
        fireEvent.change(catalogSearch, { target: { value: 'oracle' } });
        await settleSearches();
      }

      await assertCoreProductionSurfaces(headerActions, onOpenDocument);
    },
  );
});
