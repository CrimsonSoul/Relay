import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { useKnowledgeLibrary } from '../useKnowledgeLibrary';
import { KnowledgeTab } from '../KnowledgeTab';

vi.mock('../useKnowledgeLibrary', () => ({ useKnowledgeLibrary: vi.fn() }));
vi.mock('../KnowledgePdfViewer', () => ({
  KnowledgePdfViewer: ({
    document,
    target,
    resolveUrl,
    onDestinationChange,
  }: {
    document: KnowledgeDocumentRecord;
    target: { label?: string; pageIndex: number; top: number | null } | null;
    resolveUrl?: (url: string) => unknown;
    onDestinationChange?: (target: { pageIndex: number; top: number | null }) => void;
  }) => {
    let targetLabel = '';
    if (target) {
      targetLabel = 'label' in target ? `at ${target.label}` : `at page ${target.pageIndex + 1}`;
    }
    return (
      <div>
        Viewer: {document?.title ?? 'none'} {targetLabel}
        <span data-testid="viewer-resolution">
          {resolveUrl ? JSON.stringify(resolveUrl('#page=2')) : 'resolver missing'}
        </span>
        <button type="button" onClick={() => onDestinationChange?.({ pageIndex: 2, top: null })}>
          Follow native destination
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
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

describe('KnowledgeTab', () => {
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.api = {
      getKnowledgeIndexStatus: vi.fn(async () => ({
        state: 'idle',
        documentCount: 2,
        categoryCount: 2,
        lastIndexedAt: '2026-07-14T12:00:00.000Z',
      })),
      onKnowledgeIndexStatusChanged: vi.fn(() => unsubscribe),
    } as never;
  });

  afterEach(() => {
    delete globalThis.api;
  });

  it('renders the focus reader, filters by nested headings, and jumps to a selected heading', async () => {
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

    expect(screen.getByRole('heading', { name: 'Knowledge base' })).toBeInTheDocument();
    expect(screen.getByText(/Viewer: Operator guide/)).toBeInTheDocument();
    expect(screen.getByText(/2 documents across 2 categories/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search knowledge base' }), {
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
    expect(screen.getByText(/Viewer: Operator guide at page 3/)).toBeInTheDocument();
  });

  it('explains where server operators should place PDF files when the library is empty', async () => {
    useKnowledgeLibraryMock.mockReturnValue({
      documents: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(async () => undefined),
    });

    render(<KnowledgeTab active relayMode="server" />);

    expect(screen.getByText(/no knowledge documents yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/knowledge-base/i)).toHaveLength(2);
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
