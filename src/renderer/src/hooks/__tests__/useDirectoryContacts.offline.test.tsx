import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDirectoryContacts } from '../useDirectoryContacts';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import type { OfflineMutationInput } from '@shared/ipc';

const { getPb, applyOfflineMutationToStores } = vi.hoisted(() => ({
  getPb: vi.fn(() => {
    throw new Error('Network unavailable');
  }),
  applyOfflineMutationToStores: vi.fn(),
}));
vi.mock('../../services/pocketbase', () => ({
  getPb,
  getConnectionState: () => 'offline',
  handleApiError: vi.fn(),
  escapeFilter: (value: string) => value,
  requireOnline: vi.fn(),
}));
vi.mock('../../stores/collectionStoreRegistry', () => ({ applyOfflineMutationToStores }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
afterEach(() => {
  delete globalThis.api;
});
it('routes cached contact edits and deletes through the real service and offline mutation gateway', async () => {
  const cached = {
    name: 'Alice',
    email: 'alice@example.com',
    phone: '',
    title: '',
    raw: { id: 'abc123abc123abc' },
    _searchString: 'alice',
  };
  const contacts = [cached];
  const mutateOffline = vi.fn(async (input: OfflineMutationInput) => ({
    ok: true as const,
    mutationId: 'queued',
    collection: input.collection,
    action: input.action,
    record: { id: input.recordId!, ...input.data },
    pendingCount: 1,
  }));
  globalThis.api = { runtime: ELECTRON_RUNTIME, mutateOffline } as never;
  const { result } = renderHook(() => useDirectoryContacts(contacts));
  act(() => result.current.setEditingContact(cached));
  await act(async () => result.current.handleUpdateContact({ title: 'Lead' }));
  expect(mutateOffline).toHaveBeenCalledWith({
    collection: 'contacts',
    action: 'update',
    recordId: cached.raw.id,
    data: { name: 'Alice', email: cached.email, phone: '', title: 'Lead' },
  });
  expect(result.current.getEffectiveContacts()[0]?.title).toBe('Lead');
  act(() => result.current.setDeleteConfirmation(cached));
  await act(async () => result.current.handleDeleteContact());
  expect(mutateOffline).toHaveBeenLastCalledWith({
    collection: 'contacts',
    action: 'delete',
    recordId: cached.raw.id,
  });
  expect(result.current.getEffectiveContacts()).toEqual([]);
  expect(applyOfflineMutationToStores).toHaveBeenCalledTimes(2);
  expect(getPb).not.toHaveBeenCalled();
});
