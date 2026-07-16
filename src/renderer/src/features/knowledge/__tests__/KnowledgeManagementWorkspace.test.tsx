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
      uploadProgress: null,
      error: null,
      refresh: vi.fn(async () => true),
      readAudit,
      loadMoreAudit,
      loadMore: vi.fn(async () => true),
      stagePdfs,
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

    expect(screen.getByRole('heading', { name: 'Manage knowledge base' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Documents 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Uploads 0/ })).toBeInTheDocument();
    expect(screen.getByText('Checkout runbook')).toBeInTheDocument();
    expect(screen.getByText('Runbook.pdf')).toBeInTheDocument();
  });

  it('stages PDFs and loads audit history on demand', () => {
    render(<KnowledgeManagementWorkspace onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: /Audit 0/ }));

    expect(stagePdfs).toHaveBeenCalledOnce();
    expect(readAudit).toHaveBeenCalledOnce();
  });
});
