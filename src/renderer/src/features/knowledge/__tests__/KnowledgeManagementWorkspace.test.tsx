import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeManagement } from '../useKnowledgeManagement';
import { KnowledgeManagementWorkspace } from '../KnowledgeManagementWorkspace';

vi.mock('../useKnowledgeManagement', () => ({ useKnowledgeManagement: vi.fn() }));
const useKnowledgeManagementMock = vi.mocked(useKnowledgeManagement);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('KnowledgeManagementWorkspace', () => {
  const stagePdfs = vi.fn(async () => ({ ok: true as const, uploads: [] }));
  const readAudit = vi.fn(async () => true);
  const loadMoreAudit = vi.fn(async () => true);

  beforeEach(() => {
    vi.clearAllMocks();
    useKnowledgeManagementMock.mockReturnValue({
      canManage: true,
      snapshot: {
        mode: 'managed',
        categories: [
          {
            id: 'category-operations',
            name: 'Operations',
            normalizedName: 'operations',
            sortOrder: 100,
            systemKey: '',
            revision: 1,
            created: '2026-07-16T01:00:00.000Z',
            updated: '2026-07-16T01:00:00.000Z',
          },
          {
            id: 'category-uncategorized',
            name: 'Uncategorized',
            normalizedName: 'uncategorized',
            sortOrder: 200,
            systemKey: 'uncategorized',
            revision: 1,
            created: '2026-07-16T01:00:00.000Z',
            updated: '2026-07-16T01:00:00.000Z',
          },
        ],
        documents: {
          items: [
            {
              id: 'document-1',
              category: 'Operations',
              categoryId: 'category-operations',
              documentType: 'sop',
              displayTitle: 'Checkout runbook',
              fileName: 'Runbook.pdf',
              byteSize: 1_024,
              pageCount: 4,
              lifecycleState: 'active',
              revision: 2,
              publishedByName: 'Ryan Bledsoe',
              publishedAt: '2026-07-16T01:00:00.000Z',
              trashedByName: null,
              trashedAt: null,
              searchIndexState: 'ready',
              searchIndexChecksum: 'a'.repeat(64),
              searchIndexVersion: 1,
              searchIndexedAt: '2026-07-19T18:00:00.000Z',
              searchIndexError: null,
              updated: '2026-07-16T01:00:00.000Z',
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
      refresh: vi.fn(async () => true),
      readAudit,
      loadMoreAudit,
      loadMore: vi.fn(async () => true),
      stagePdfs,
      pauseUploadBatch: vi.fn(),
      resumeUploadBatch: vi.fn(),
      retryUpload: vi.fn(),
      reselectUploadSource: vi.fn(),
      cancelUpload: vi.fn(),
      cancelUploadBatch: vi.fn(),
      clearError: vi.fn(),
      retrySearchIndex: vi.fn(async () => true),
      publish: vi.fn(),
      replace: vi.fn(),
      setTitle: vi.fn(),
      setCategory: vi.fn(),
      renameCategory: vi.fn(),
      createCategory: vi.fn(),
      setCategoryName: vi.fn(),
      setCategoryOrder: vi.fn(),
      deleteCategory: vi.fn(),
      setDocumentMetadata: vi.fn(async () => true),
      assignDocumentCategories: vi.fn(async () => true),
      trash: vi.fn(),
      restore: vi.fn(),
      deletePermanently: vi.fn(),
    });
  });

  it('presents the dedicated document, upload, trash, and audit workspace', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Manage Wiki' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Stage, review, publish, and recover PDF guides shared across the Relay team.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/shared with every operator/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Documents 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Uploads 0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Categories 2/ })).toBeInTheDocument();
    expect(screen.getByText('Checkout runbook')).toBeInTheDocument();
    expect(screen.getByText('Runbook.pdf')).toBeInTheDocument();
    const documentEyebrow = screen
      .getByRole('checkbox', { name: 'Select Checkout runbook' })
      .closest('.knowledge-management-row__eyebrow');
    expect(documentEyebrow).not.toBeNull();
    expect(within(documentEyebrow as HTMLElement).getByText(/SOP MANUAL · 4 pages/i)).toBeVisible();
    const trashButton = screen.getByRole('button', { name: 'Trash' });
    expect(trashButton).toHaveClass('tactile-button--danger');
    expect(trashButton).toHaveClass('knowledge-management__danger-outline');
    expect(screen.getByRole('searchbox', { name: 'Search managed documents' })).toHaveClass(
      'scoped-search-input',
    );
  });

  it('keeps every section and document action reachable in the operational workspace', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    const rail = screen.getByRole('navigation', { name: 'Knowledge management' });
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining('documents'),
      expect.stringContaining('categories'),
      expect.stringContaining('uploads'),
      expect.stringContaining('trash'),
      expect.stringContaining('audit'),
    ]);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace PDF' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trash' })).toBeVisible();
  });

  it('shows aggregate readiness only while documents remain unsearchable', () => {
    const current = useKnowledgeManagementMock();
    const readyDocument = current.snapshot!.documents.items[0]!;
    const pendingDocument = {
      ...readyDocument,
      id: 'document-2',
      displayTitle: 'Escalation guide',
      fileName: 'Escalation.pdf',
      searchIndexState: 'pending' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
    };
    const failedDocument = {
      ...pendingDocument,
      id: 'document-3',
      displayTitle: 'Failover guide',
      fileName: 'Failover.pdf',
      searchIndexState: 'failed' as const,
      searchIndexError: 'extraction-failed' as const,
    };
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [readyDocument, pendingDocument, failedDocument], nextCursor: null },
      },
    });

    const { rerender } = render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    expect(screen.getByText('1 of 3 searchable')).toBeVisible();
    expect(screen.getByText('Search ready')).toBeVisible();
    expect(screen.getByText('Indexing search')).toBeVisible();
    expect(screen.getByText('Search needs retry')).toBeVisible();
    const retry = screen.getByRole('button', { name: 'Retry search for Failover guide' });
    const readiness = retry.closest('.knowledge-management-row__search');
    expect(readiness).toContainElement(screen.getByText('Search needs retry'));
    expect(retry.closest('.knowledge-management-row__actions')).toBeNull();

    useKnowledgeManagementMock.mockReturnValue(current);
    rerender(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    expect(screen.queryByText('1 of 1 searchable')).not.toBeInTheDocument();
  });

  it('loads retry by operation key and restores the matching retry after a reordered refresh', async () => {
    const current = useKnowledgeManagementMock();
    const failedDocument = {
      ...current.snapshot!.documents.items[0]!,
      searchIndexState: 'failed' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: 'storage-unavailable' as const,
    };
    const otherDocument = {
      ...failedDocument,
      id: 'document-2',
      displayTitle: 'Escalation guide',
      fileName: 'Escalation.pdf',
      searchIndexState: 'pending' as const,
      searchIndexError: null,
    };
    const retryResult = deferred<boolean>();
    const retrySearchIndex = vi.fn(() => retryResult.promise);
    let management = {
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [failedDocument, otherDocument], nextCursor: null },
      },
      retrySearchIndex,
    };
    useKnowledgeManagementMock.mockImplementation(() => management);
    const { rerender } = render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    const firstRetry = screen.getByRole('button', {
      name: 'Retry search for Checkout runbook',
    });

    fireEvent.click(firstRetry);
    expect(retrySearchIndex).toHaveBeenCalledWith('document-1');

    management = { ...management, busy: 'search-index:document-1' };
    rerender(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry search for Checkout runbook' })).toHaveClass(
      'is-loading',
    );

    management = {
      ...management,
      busy: null,
      snapshot: {
        ...management.snapshot!,
        documents: { items: [otherDocument, failedDocument], nextCursor: null },
      },
    };
    rerender(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    retryResult.resolve(true);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry search for Checkout runbook' }),
      ).toHaveFocus(),
    );
  });

  it('moves retry focus to the same document status when indexing starts', async () => {
    const current = useKnowledgeManagementMock();
    const failedDocument = {
      ...current.snapshot!.documents.items[0]!,
      searchIndexState: 'failed' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: 'extraction-failed' as const,
    };
    const retryResult = deferred<boolean>();
    let management = {
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [failedDocument], nextCursor: null },
      },
      retrySearchIndex: vi.fn(() => retryResult.promise),
    };
    useKnowledgeManagementMock.mockImplementation(() => management);
    const { rerender } = render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry search for Checkout runbook' }));
    management = {
      ...management,
      snapshot: {
        ...management.snapshot!,
        documents: {
          items: [
            {
              ...failedDocument,
              searchIndexState: 'pending',
              searchIndexError: null,
            },
          ],
          nextCursor: null,
        },
      },
    };
    rerender(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    retryResult.resolve(true);

    await waitFor(() => expect(screen.getByText('Indexing search')).toHaveFocus());
    expect(
      screen.queryByRole('button', { name: 'Retry search for Checkout runbook' }),
    ).not.toBeInTheDocument();
  });

  it('restores retry focus after the protected operation reports an error', async () => {
    const current = useKnowledgeManagementMock();
    const failedDocument = {
      ...current.snapshot!.documents.items[0]!,
      searchIndexState: 'failed' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: 'storage-unavailable' as const,
    };
    const retrySearchIndex = vi.fn(async () => false);
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [failedDocument], nextCursor: null },
      },
      retrySearchIndex,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    const retry = screen.getByRole('button', { name: 'Retry search for Checkout runbook' });

    fireEvent.click(retry);

    expect(retrySearchIndex).toHaveBeenCalledWith('document-1');
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it('moves retry focus to the Documents heading when the authoritative row is removed', async () => {
    const current = useKnowledgeManagementMock();
    const failedDocument = {
      ...current.snapshot!.documents.items[0]!,
      searchIndexState: 'failed' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: 'extraction-failed' as const,
    };
    const retryResult = deferred<boolean>();
    let management = {
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [failedDocument], nextCursor: null },
      },
      retrySearchIndex: vi.fn(() => retryResult.promise),
    };
    useKnowledgeManagementMock.mockImplementation(() => management);
    const { rerender } = render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry search for Checkout runbook' }));
    management = {
      ...management,
      snapshot: {
        ...management.snapshot!,
        documents: { items: [], nextCursor: null },
      },
    };
    rerender(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    retryResult.resolve(false);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documents' })).toHaveFocus());
  });

  it('moves retry focus to the Documents heading when the target is filtered out', async () => {
    const current = useKnowledgeManagementMock();
    const failedDocument = {
      ...current.snapshot!.documents.items[0]!,
      searchIndexState: 'failed' as const,
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: 'storage-unavailable' as const,
    };
    const retryResult = deferred<boolean>();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [failedDocument], nextCursor: null },
      },
      retrySearchIndex: vi.fn(() => retryResult.promise),
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry search for Checkout runbook' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search managed documents' }), {
      target: { value: 'no matching document' },
    });
    expect(
      screen.queryByRole('button', { name: 'Retry search for Checkout runbook' }),
    ).not.toBeInTheDocument();
    retryResult.resolve(true);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documents' })).toHaveFocus());
  });

  it('validates document editor fields without discarding the draft', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Display title');
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a display title.');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveValue('   ');
    expect(title).toHaveFocus();
  });

  it('keeps Return to library reachable when publisher capability expires', () => {
    const onExit = vi.fn();
    useKnowledgeManagementMock.mockReturnValue({
      ...useKnowledgeManagementMock(),
      canManage: false,
      snapshot: null,
      error: 'Password confirmation was not accepted. Try again.',
    });

    render(<KnowledgeManagementWorkspace onExit={onExit} />);

    expect(screen.getByRole('alert').closest('.knowledge-management')).toHaveClass(
      'knowledge-management--access-lost',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Publisher access ended');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password confirmation was not accepted. Try again.',
    );
    expect(screen.queryByRole('button', { name: 'Add PDFs' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to library' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('edits categories and document classification from the management workspace', () => {
    const setDocumentMetadata = vi.fn(async () => true);
    useKnowledgeManagementMock.mockReturnValue({
      ...useKnowledgeManagementMock(),
      setDocumentMetadata,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Documents 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Document type'), {
      target: { value: 'cheatsheet' },
    });
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'category-uncategorized' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(setDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'document-1', revision: 2 }),
      'Checkout runbook',
      'category-uncategorized',
      'cheatsheet',
    );
  });

  it('uses the shared tactile field vocabulary throughout management forms', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    expect(screen.getByLabelText('Bulk category')).toHaveClass('tactile-input');
    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    expect(screen.getByLabelText('New category name')).toHaveClass('tactile-input');
    expect(screen.getByLabelText('Category name Operations')).toHaveClass('tactile-input');
  });

  it('restores an independent scroll position for every management section', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    const content = screen.getByLabelText('Documents management section');
    content.scrollTop = 180;

    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    expect(screen.getByLabelText('Categories management section').scrollTop).toBe(0);
    content.scrollTop = 72;

    fireEvent.click(screen.getByRole('button', { name: /Documents 1/ }));
    expect(screen.getByLabelText('Documents management section').scrollTop).toBe(180);

    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    expect(screen.getByLabelText('Categories management section').scrollTop).toBe(72);
  });

  it('preserves current tab scroll state when asynchronous PDF staging changes sections', async () => {
    const staging = deferred<Awaited<ReturnType<typeof stagePdfs>>>();
    const delayedStagePdfs = vi.fn(() => staging.promise);
    useKnowledgeManagementMock.mockReturnValue({
      ...useKnowledgeManagementMock(),
      stagePdfs: delayedStagePdfs,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    const content = screen.getByLabelText('Documents management section');
    content.scrollTop = 180;

    fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    content.scrollTop = 72;
    staging.resolve({
      ok: true,
      uploads: [
        {
          id: 'delayed-upload',
          uploadId: null,
          batchId: 'batch-delayed',
          fileName: 'Delayed.pdf',
          byteSize: 1_024,
          acknowledgedBytes: 0,
          chunkCount: 1,
          acknowledgedChunkCount: 0,
          state: 'queued',
          safeError: null,
          retryCount: 0,
          restartRecovery: false,
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Uploads management section')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Categories 2/ }));
    expect(screen.getByLabelText('Categories management section').scrollTop).toBe(72);
    fireEvent.click(screen.getByRole('button', { name: /Documents 1/ }));
    expect(screen.getByLabelText('Documents management section').scrollTop).toBe(180);
  });

  it('stages PDFs and loads audit history when the workspace opens', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    expect(readAudit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: /Audit 0/ }));

    expect(stagePdfs).toHaveBeenCalledOnce();
    expect(readAudit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Audit management section')).toHaveClass(
      'knowledge-management__content',
    );

    fireEvent.click(screen.getByRole('button', { name: /Documents 1/ }));
    expect(screen.getByLabelText('Documents management section')).toHaveClass(
      'knowledge-management__content',
    );
  });

  it('always queues new PDFs for review before publishing', async () => {
    const publish = vi.fn(async () => true);
    const stageForReview = vi.fn(async () => ({
      ok: true as const,
      uploads: [
        {
          id: 'local-review-upload',
          uploadId: null,
          batchId: 'batch-1',
          fileName: 'Escalation.pdf',
          byteSize: 1_024,
          acknowledgedBytes: 0,
          chunkCount: 1,
          acknowledgedChunkCount: 0,
          state: 'queued' as const,
          safeError: null,
          retryCount: 0,
          restartRecovery: false,
        },
      ],
    }));
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      stagePdfs: stageForReview,
      publish,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    expect(screen.queryByRole('combobox', { name: 'After upload' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
    await waitFor(() => expect(stageForReview).toHaveBeenCalledOnce());

    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByText('1 PDF queued.')).toBeInTheDocument();
  });

  it('publishes an upload into an existing category selected from the category list', () => {
    const publish = vi.fn(async () => true);
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        categories: [
          ...current.snapshot!.categories,
          {
            id: 'category-site-ops',
            name: 'Site Ops',
            normalizedName: 'site ops',
            sortOrder: 300,
            systemKey: '',
            revision: 1,
            created: '2026-07-16T01:00:00.000Z',
            updated: '2026-07-16T01:00:00.000Z',
          },
          {
            id: 'category-sentinel-name',
            name: '__new_category__',
            normalizedName: '__new_category__',
            sortOrder: 400,
            systemKey: '',
            revision: 1,
            created: '2026-07-16T01:00:00.000Z',
            updated: '2026-07-16T01:00:00.000Z',
          },
        ],
        uploads: {
          nextCursor: null,
          items: [
            {
              id: 'upload-1',
              requestId: 'request-1',
              fileName: 'Escalation.pdf',
              byteSize: 1_024,
              checksum: 'b'.repeat(64),
              state: 'ready',
              progress: 100,
              proposedTitle: 'Escalation guide',
              proposedCategory: 'Site   Ops',
              pageCount: 4,
              outlineSource: 'native',
              outlineCount: 3,
              duplicateDocumentId: null,
              safeError: null,
              expiresAt: '2026-07-23T01:00:00.000Z',
              revision: 1,
            },
          ],
        },
      },
      publish,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));

    const category = screen.getByRole('combobox', { name: 'Category' });
    expect(category).toHaveValue('category-site-ops');
    expect(screen.queryByRole('textbox', { name: 'New category name' })).not.toBeInTheDocument();
    expect(within(category).getByRole('option', { name: 'Operations' })).toBeInTheDocument();
    expect(within(category).getByRole('option', { name: 'Uncategorized' })).toBeInTheDocument();
    fireEvent.change(category, { target: { value: 'category-sentinel-name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(publish).toHaveBeenCalledWith('upload-1', 'Escalation guide', '__new_category__', 'sop');
  });

  it('keeps new-category creation available from upload review', () => {
    const publish = vi.fn(async () => true);
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        uploads: {
          nextCursor: null,
          items: [
            {
              id: 'upload-1',
              requestId: 'request-1',
              fileName: 'Escalation.pdf',
              byteSize: 1_024,
              checksum: 'b'.repeat(64),
              state: 'ready',
              progress: 100,
              proposedTitle: 'Escalation guide',
              proposedCategory: 'Operations',
              pageCount: 4,
              outlineSource: 'native',
              outlineCount: 3,
              duplicateDocumentId: null,
              safeError: null,
              expiresAt: '2026-07-23T01:00:00.000Z',
              revision: 1,
            },
          ],
        },
      },
      publish,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: '__new_category__' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'New category name' }), {
      target: { value: 'Network' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(publish).toHaveBeenCalledWith('upload-1', 'Escalation guide', 'Network', 'sop');
  });

  it('presents aggregate and per-file controls for a resumable VPN upload', () => {
    const resumeUploadBatch = vi.fn();
    const retryUpload = vi.fn();
    const cancelUpload = vi.fn();
    useKnowledgeManagementMock.mockReturnValue({
      ...useKnowledgeManagementMock(),
      uploadQueue: {
        restartRecovery: true,
        activeBatchId: 'batch-1',
        totalBytes: 1_000,
        acknowledgedBytes: 400,
        items: [
          {
            id: 'local-1',
            uploadId: 'upload-1',
            batchId: 'batch-1',
            fileName: 'Runbook.pdf',
            byteSize: 1_000,
            acknowledgedBytes: 400,
            chunkCount: 2,
            acknowledgedChunkCount: 1,
            state: 'paused-network',
            safeError: 'offline',
            retryCount: 8,
            restartRecovery: true,
          },
        ],
      },
      resumeUploadBatch,
      retryUpload,
      cancelUpload,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));

    expect(screen.getByText('Upload queue')).toBeInTheDocument();
    expect(screen.getByText('Restored after restart')).toBeInTheDocument();
    expect(screen.getByText('Waiting for network')).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    const cancelFile = screen.getByRole('button', { name: 'Cancel Runbook.pdf' });
    const cancelBatch = screen.getByRole('button', { name: 'Cancel batch' });

    expect(cancelFile).toHaveClass('tactile-button--danger');
    expect(cancelFile).toHaveClass('knowledge-management__danger-outline');
    expect(cancelBatch).toHaveClass('tactile-button--danger');
    expect(cancelBatch).toHaveClass('knowledge-management__danger-outline');

    fireEvent.click(cancelBatch);

    const confirmCancel = screen.getByRole('button', { name: 'Confirm cancel' });
    expect(confirmCancel).toHaveClass('tactile-button--danger');
    expect(confirmCancel).not.toHaveClass('knowledge-management__danger-outline');

    fireEvent.click(screen.getByRole('button', { name: 'Keep upload' }));
    expect(screen.getByRole('button', { name: 'Cancel batch' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel batch' }));

    fireEvent.click(screen.getByRole('button', { name: 'Resume all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Runbook.pdf' }));
    fireEvent.click(cancelFile);

    expect(resumeUploadBatch).toHaveBeenCalledWith('batch-1');
    expect(retryUpload).toHaveBeenCalledWith('upload-1');
    expect(cancelUpload).toHaveBeenCalledWith('upload-1');
  });

  it('turns a duplicate ready upload into an explicit replace or discard decision', async () => {
    const replace = vi.fn(async () => true);
    const cancelUpload = vi.fn(async () => true);
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        uploads: {
          nextCursor: null,
          items: [
            {
              id: 'upload-1',
              requestId: 'request-1',
              fileName: 'Runbook.pdf',
              byteSize: 1_024,
              checksum: 'a'.repeat(64),
              state: 'ready',
              progress: 100,
              proposedTitle: 'Checkout runbook',
              proposedCategory: 'Operations',
              pageCount: 4,
              outlineSource: 'native',
              outlineCount: 3,
              duplicateDocumentId: 'document-1',
              safeError: null,
              expiresAt: '2026-07-23T01:00:00.000Z',
              revision: 2,
            },
          ],
        },
      },
      replace,
      cancelUpload,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace existing' }));

    expect(replace).toHaveBeenCalledWith(
      'upload-1',
      'document-1',
      2,
      'Checkout runbook',
      'Operations',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Discard Runbook.pdf' }));

    const keep = screen.getByRole('button', { name: 'Keep Runbook.pdf' });
    expect(keep).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Confirm discard Runbook.pdf' })).toBeInTheDocument();

    fireEvent.click(keep);
    expect(cancelUpload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard Runbook.pdf' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Discard Runbook.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard Runbook.pdf' }));

    await waitFor(() => expect(cancelUpload).toHaveBeenCalledWith('upload-1'));
  });

  it('keeps cancelled upload records out of review', () => {
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        uploads: {
          nextCursor: null,
          items: [
            {
              id: 'upload-cancelled',
              requestId: 'request-cancelled',
              fileName: 'Discarded.pdf',
              byteSize: 1_024,
              checksum: 'a'.repeat(64),
              state: 'cancelled',
              progress: 50,
              proposedTitle: 'Discarded',
              proposedCategory: 'Operations',
              pageCount: 4,
              outlineSource: 'native',
              outlineCount: 3,
              duplicateDocumentId: null,
              safeError: null,
              expiresAt: '2026-07-23T01:00:00.000Z',
              revision: 3,
            },
          ],
        },
      },
    });

    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 0/ }));

    expect(screen.queryByText('Discarded.pdf')).not.toBeInTheDocument();
    expect(
      screen.getByText('No uploads queued or awaiting review. Add PDFs to begin.'),
    ).toBeVisible();
  });

  it('removes transfer controls once a queued PDF is ready for review', () => {
    const current = useKnowledgeManagementMock();
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      uploadQueue: {
        restartRecovery: false,
        activeBatchId: 'batch-1',
        totalBytes: 1_024,
        acknowledgedBytes: 1_024,
        items: [
          {
            id: 'local-1',
            uploadId: 'upload-1',
            batchId: 'batch-1',
            fileName: 'Ready.pdf',
            byteSize: 1_024,
            acknowledgedBytes: 1_024,
            chunkCount: 1,
            acknowledgedChunkCount: 1,
            state: 'ready',
            safeError: null,
            retryCount: 0,
            restartRecovery: false,
          },
        ],
      },
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));

    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel batch' })).not.toBeInTheDocument();
  });

  it('offers source reselection when an interrupted upload loses its local PDF', () => {
    const reselectUploadSource = vi.fn();
    useKnowledgeManagementMock.mockReturnValue({
      ...useKnowledgeManagementMock(),
      uploadQueue: {
        restartRecovery: true,
        activeBatchId: 'batch-1',
        totalBytes: 1_024,
        acknowledgedBytes: 512,
        items: [
          {
            id: 'local-1',
            uploadId: 'upload-1',
            batchId: 'batch-1',
            fileName: 'Missing.pdf',
            byteSize: 1_024,
            acknowledgedBytes: 512,
            chunkCount: 2,
            acknowledgedChunkCount: 1,
            state: 'source-required',
            safeError: 'source-required',
            retryCount: 1,
            restartRecovery: true,
          },
        ],
      },
      reselectUploadSource,
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Uploads 1/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Reselect Missing.pdf' }));

    expect(screen.getByText('Original PDF must be reselected')).toBeInTheDocument();
    expect(reselectUploadSource).toHaveBeenCalledWith('upload-1');
  });

  it('traps permanent-delete focus and restores it to the initiating button on cancel', async () => {
    const current = useKnowledgeManagementMock();
    const trashedDocument = {
      ...current.snapshot!.documents.items[0]!,
      lifecycleState: 'trashed' as const,
      trashedByName: 'Paris',
      trashedAt: '2026-07-19T12:00:00.000Z',
    };
    useKnowledgeManagementMock.mockReturnValue({
      ...current,
      snapshot: {
        ...current.snapshot!,
        documents: { items: [], nextCursor: null },
        trash: { items: [trashedDocument], nextCursor: null },
      },
    });
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Trash 1/ }));
    const deleteTrigger = screen.getByRole('button', { name: 'Delete permanently' });
    fireEvent.click(deleteTrigger);

    const confirmation = screen.getByRole('dialog', { name: 'Delete Checkout runbook' });
    const passwordInput = within(confirmation).getByLabelText('Confirm your password');
    const cancel = within(confirmation).getByRole('button', { name: 'Cancel' });
    const confirmDelete = within(confirmation).getByRole('button', {
      name: 'Delete permanently',
    });
    await waitFor(() => expect(passwordInput).toHaveFocus());
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    confirmDelete.focus();
    fireEvent.keyDown(confirmDelete, { key: 'Tab' });
    expect(passwordInput).toHaveFocus();
    fireEvent.keyDown(passwordInput, { key: 'Tab', shiftKey: true });
    expect(confirmDelete).toHaveFocus();

    fireEvent.click(cancel);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete permanently' })).toHaveFocus(),
    );
  });
});
