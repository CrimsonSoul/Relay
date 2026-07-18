import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { useKnowledgeLibrary } from '../useKnowledgeLibrary';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import type { KnowledgeViewerTarget } from '../knowledgePdfDestination';
import { KnowledgeTab } from '../KnowledgeTab';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../useKnowledgeLibrary', () => ({ useKnowledgeLibrary: vi.fn() }));
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: toastMocks.showToast }),
}));
vi.mock('../../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: () => ({
    session: {
      state: 'signed-out',
      accountId: null,
      operatorId: null,
      operatorName: null,
      role: null,
      capabilities: [],
      deviceId: null,
      expiresAt: null,
    },
  }),
}));

type ViewerMockProps = {
  document: KnowledgeDocumentRecord | null;
  target: KnowledgeViewerTarget | null;
  currentSection?: string | null;
  focusRequestKey?: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onDestinationChange: (target: KnowledgeViewerTarget) => void;
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

function document(id: string, title: string, category: string): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `${category}/${title}.pdf`,
    category,
    title,
    fileName: `${title}.pdf`,
    pdf: `${title}.pdf`,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 3,
    outline: [
      { id: `${id}-heading`, label: 'Restart the lane service', level: 1, pageIndex: 1, top: 600 },
    ],
    outlineSource: 'native',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    lifecycleState: 'active',
    displayTitle: title,
    revision: 1,
    publishedByOperatorId: '',
    publishedByName: '',
    publishedAt: '2026-07-14T12:00:00.000Z',
    trashedByOperatorId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

describe('KnowledgeTab', () => {
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    latestViewerProps = null;
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

  it('reports the document count after a usable Wiki snapshot loads', async () => {
    const onLibraryCountChange = vi.fn();
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [
        document('guide', 'Operator guide', 'General'),
        document('lane', 'Lane recovery', 'Store systems'),
      ],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" onLibraryCountChange={onLibraryCountChange} />);

    await waitFor(() => expect(onLibraryCountChange).toHaveBeenLastCalledWith(2));
  });

  it('reports an unavailable count before a usable snapshot and when loading fails', async () => {
    const onLibraryCountChange = vi.fn();
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(screen.getByRole('heading', { name: 'Wiki' })).toBeInTheDocument();
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(screen.getByText(/2 documents across 2 categories/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Wiki' }), {
      target: { value: 'lane service' },
    });
    expect(screen.getByRole('treeitem', { name: 'Operator guide' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'Lane recovery' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 matching across 1 category$/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('treeitem', { name: 'Restart the lane service, page 2' })[0]!,
    );
    expect(screen.getByText(/at Restart the lane service/)).toBeInTheDocument();
    await waitFor(() => expect(globalThis.api?.getKnowledgeIndexStatus).toHaveBeenCalled());
  });

  it('provides the viewer with pure URL resolution and accepts native destination targets', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);

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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    const search = screen.getByRole('searchbox', { name: 'Search Wiki' });
    fireEvent.change(search, { target: { value: 'Operator' } });

    fireEvent.click(screen.getByRole('button', { name: 'Activate Lane recovery.pdf#page=3' }));

    expect(screen.getByTestId('viewer-document-id')).toHaveTextContent('lane');
    expect(screen.getByText(/Viewer: Lane recovery at page 3/)).toBeInTheDocument();
    expect(screen.getByTestId('viewer-current-section')).toHaveTextContent('Document section');
    expect(screen.getByTestId('viewer-focus-key')).toHaveTextContent('1');
    expect(search).toHaveValue('');
  });

  it('follows a current-document page link without selecting or refocusing another guide', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

    fireEvent.click(screen.getByRole('button', { name: `Activate ${url}` }));

    expect(toastMocks.showToast).toHaveBeenCalledWith(message, 'error');
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
  });

  it('reports an invalid native destination with approved copy and without IPC', () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('current', 'Current', '00 Source')],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);

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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="client" />);
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();

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

    await waitFor(() => expect(screen.getByText(/Indexed Jul 14/i)).toBeInTheDocument());
    expect(globalThis.api?.openKnowledgeWebLink).not.toHaveBeenCalled();
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
    expect(toastMocks.showToast).not.toHaveBeenCalled();
  });

  it('does not let a stale resolved action reopen a document removed by realtime sync', () => {
    const guide = document('guide', 'Operator guide', 'General');
    const lane = document('lane', 'Lane recovery', 'Store systems');
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide, lane],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    const { rerender } = render(<KnowledgeTab active relayMode="client" />);
    const pendingLink = latestViewerProps!.resolveUrl('Lane recovery.pdf#page=2');
    const staleActivation = latestViewerProps!.onActivateResolvedLink;

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
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

  it('clears a removed active document instead of silently opening another guide', () => {
    const guide = document('guide', 'Operator guide', 'General');
    const lane = document('lane', 'Lane recovery', 'Store systems');
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide, lane],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    const { rerender } = render(<KnowledgeTab active relayMode="client" />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Store systems, 1 document' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Lane recovery' }));

    useKnowledgeLibraryMock.mockReturnValue({
      documents: [guide],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    rerender(<KnowledgeTab active relayMode="client" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Lane recovery.*removed/i);
    expect(screen.queryByText(/Viewer: Operator guide/)).not.toBeInTheDocument();
  });

  it('surfaces server index warnings in the library footer', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });
    render(<KnowledgeTab active relayMode="server" />);
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
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);

    expect(await screen.findByText(/Indexed Jul 14/i)).toBeInTheDocument();
    expect(screen.queryByText('Waiting for first index')).not.toBeInTheDocument();
  });

  it('keeps the library usable when index status is temporarily unavailable', async () => {
    vi.mocked(globalThis.api!.getKnowledgeIndexStatus).mockRejectedValueOnce(
      new Error('status unavailable'),
    );
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [document('guide', 'Operator guide', 'General')],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="client" />);

    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    await waitFor(() => expect(globalThis.api?.getKnowledgeIndexStatus).toHaveBeenCalled());
  });
});
