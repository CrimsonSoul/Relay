import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { useKnowledgeManagement } from '../useKnowledgeManagement';

vi.mock('../../../contexts/PrivilegedAccessContext', () => ({ usePrivilegedAccess: vi.fn() }));

const usePrivilegedAccessMock = vi.mocked(usePrivilegedAccess);
const snapshot = {
  mode: 'managed',
  documents: { items: [], nextCursor: null },
  trash: { items: [], nextCursor: null },
  uploads: { items: [], nextCursor: null },
};

describe('useKnowledgeManagement', () => {
  const submitCommand = vi.fn(async (input: { command: string }) => ({
    ok: true as const,
    requestId: 'request-1',
    value: input.command === 'knowledge.snapshot.read' ? snapshot : {},
  }));
  const reauthenticate = vi.fn(async () => ({
    proofId: 'proof-1',
    expiresAt: '2026-07-16T02:00:00.000Z',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    usePrivilegedAccessMock.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-publisher',
        operatorId: 'operator-publisher',
        operatorName: 'Tristan Bowles',
        role: 'publisher',
        capabilities: ['privileged.status.read', 'knowledge.manage'],
        deviceId: 'device-1',
        expiresAt: '2026-07-16T03:00:00.000Z',
      },
      submitCommand,
      reauthenticate,
    } as never);
    globalThis.api = {
      selectAndStageKnowledgePdfs: vi.fn(async () => ({ ok: true, uploads: [] })),
    } as never;
  });

  it('loads a signed management snapshot only for an authorized active session', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: null, pageSize: 25 },
      expectedRevision: null,
    });
    expect(result.current.canManage).toBe(true);
  });

  it('refreshes after staging and sends optimistic revisions for lifecycle actions', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.stagePdfs());
    await act(() =>
      result.current.trash({
        documentId: 'document-1',
        expectedRevision: 4,
      }),
    );

    expect(globalThis.api?.selectAndStageKnowledgePdfs).toHaveBeenCalledOnce();
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.trash',
      payload: { documentId: 'document-1', expectedRevision: 4 },
      expectedRevision: null,
    });
  });

  it('reauthenticates before permanent deletion', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.deletePermanently('document-1', 7, 'secret'));

    expect(reauthenticate).toHaveBeenCalledWith('secret');
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.delete',
      payload: {
        documentId: 'document-1',
        expectedRevision: 7,
        reauthRequestId: 'proof-1',
      },
      expectedRevision: null,
    });
  });

  it('paginates retained audit history without duplicating events', async () => {
    const first = {
      id: 'audit-1',
      requestId: 'request-audit-1',
      action: 'published',
      targetId: 'document-1',
      fileName: 'Runbook.pdf',
      title: 'Runbook',
      category: 'Operations',
      operatorId: 'operator-publisher',
      operatorName: 'Tristan Bowles',
      occurredAt: '2026-07-16T01:00:00.000Z',
    };
    const second = { ...first, id: 'audit-2', requestId: 'request-audit-2' };
    submitCommand.mockImplementation(async (input: { command: string; payload?: unknown }) => {
      if (input.command === 'knowledge.snapshot.read') {
        return { ok: true as const, requestId: 'request-snapshot', value: snapshot };
      }
      const cursor = (input.payload as { cursor?: string | null } | undefined)?.cursor;
      return {
        ok: true as const,
        requestId: 'request-audit',
        value:
          cursor === 'audit-1'
            ? { items: [second], nextCursor: null }
            : { items: [first], nextCursor: 'audit-1' },
      };
    });

    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.readAudit());
    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-1']);
    expect(result.current.auditNextCursor).toBe('audit-1');

    await act(() => result.current.loadMoreAudit());
    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-1', 'audit-2']);
    expect(result.current.auditNextCursor).toBeNull();
  });
});
