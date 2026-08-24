import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrivilegedCommandContextValue } from '../../../contexts/PrivilegedCommandContext';
import { useKnowledgeAudit } from '../useKnowledgeAudit';

const first = {
  id: 'audit-1',
  requestId: 'request-audit-1',
  action: 'published' as const,
  targetId: 'document-1',
  fileName: 'Runbook.pdf',
  title: 'Runbook',
  category: 'Operations',
  accountId: 'account-publisher',
  actorDisplayName: 'Wiki Publisher',
  occurredAt: '2026-07-16T01:00:00.000Z',
};

describe('useKnowledgeAudit', () => {
  it('owns audit pagination and de-duplicates retained events', async () => {
    const second = { ...first, id: 'audit-2', requestId: 'request-audit-2' };
    const submitCommand = vi.fn<PrivilegedCommandContextValue['submitCommand']>(async (input) => {
      const cursor = (input.payload as { cursor?: string | null }).cursor;
      return {
        ok: true,
        requestId: 'request-audit',
        value:
          cursor === 'audit-1'
            ? { items: [first, second], nextCursor: null }
            : { items: [first], nextCursor: 'audit-1' },
      };
    });
    const setBusy = vi.fn();
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useKnowledgeAudit({
        canManage: true,
        managementIdentity: 'account-publisher\0device-1',
        submitCommand,
        setBusy,
        setError,
      }),
    );

    await act(() => result.current.readAudit());
    await act(() => result.current.loadMoreAudit());

    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-1', 'audit-2']);
    expect(result.current.auditNextCursor).toBeNull();
    expect(setBusy).toHaveBeenCalledWith('audit');
    expect(setBusy).toHaveBeenCalledWith('more:audit');
  });
});
