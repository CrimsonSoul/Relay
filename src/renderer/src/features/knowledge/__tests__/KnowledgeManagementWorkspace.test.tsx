import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeManagement } from '../useKnowledgeManagement';
import { KnowledgeManagementWorkspace } from '../KnowledgeManagementWorkspace';

vi.mock('../useKnowledgeManagement', () => ({ useKnowledgeManagement: vi.fn() }));
const useKnowledgeManagementMock = vi.mocked(useKnowledgeManagement);

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
        documents: {
          items: [
            {
              id: 'document-1',
              category: 'Operations',
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
      publish: vi.fn(),
      replace: vi.fn(),
      setTitle: vi.fn(),
      setCategory: vi.fn(),
      renameCategory: vi.fn(),
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
    expect(screen.getByText('Checkout runbook')).toBeInTheDocument();
    expect(screen.getByText('Runbook.pdf')).toBeInTheDocument();
    const trashButton = screen.getByRole('button', { name: 'Trash' });
    expect(trashButton).toHaveClass('tactile-button--danger');
    expect(trashButton).toHaveClass('knowledge-management__danger-outline');
  });

  it('stages PDFs and loads audit history on demand', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: /Audit 0/ }));

    expect(stagePdfs).toHaveBeenCalledOnce();
    expect(readAudit).toHaveBeenCalledOnce();
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

    fireEvent.click(screen.getByRole('button', { name: 'Resume all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Runbook.pdf' }));
    fireEvent.click(cancelFile);

    expect(resumeUploadBatch).toHaveBeenCalledWith('batch-1');
    expect(retryUpload).toHaveBeenCalledWith('upload-1');
    expect(cancelUpload).toHaveBeenCalledWith('upload-1');
  });

  it('turns a duplicate ready upload into an explicit replace action', () => {
    const replace = vi.fn(async () => true);
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
});
