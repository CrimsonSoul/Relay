import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useServers } from '../useServers';
import type { Contact, Server } from '@shared/ipc';
import type { MouseEvent as ReactMouseEvent } from 'react';

// Mock PocketBase server service
const mockDeleteServer = vi.fn();
vi.mock('../../services/serverService', () => ({
  addServer: vi.fn(),
  deleteServer: (...args: unknown[]) => mockDeleteServer(...args),
}));

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

describe('useServers', () => {
  // Tuple-typed so the individual fixtures stay directly addressable under
  // `noUncheckedIndexedAccess` when a test hands one server to the hook.
  const servers: [Server, Server] = [
    {
      name: 'Alpha',
      businessArea: 'Finance',
      lob: 'Core',
      comment: '',
      owner: 'Owner A',
      contact: 'alpha@test.com',
      os: 'Linux',
      _searchString: 'alpha finance core owner a linux',
      raw: { id: 'pb-1' },
    },
    {
      name: 'Bravo',
      businessArea: 'IT',
      lob: 'Infra',
      comment: '',
      owner: 'Owner B',
      contact: 'bravo@test.com',
      os: 'Windows',
      _searchString: 'bravo it infra owner b windows',
      raw: { id: 'pb-2' },
    },
  ];

  const contacts: Contact[] = [
    {
      name: 'Alice',
      email: 'alpha@test.com',
      phone: '5551112222',
      title: 'Engineer',
      _searchString: '',
      raw: {},
    },
  ];

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('builds contact lookup and filters/sorts servers', () => {
    const { result } = renderHook(() => useServers(servers, contacts));

    expect(result.current.contactLookup.get('alpha@test.com')?.name).toBe('Alice');
    expect(result.current.contactLookup.get('alice')?.email).toBe('alpha@test.com');
    expect(result.current.filteredServers.map((s) => s.name)).toEqual(['Alpha', 'Bravo']);

    act(() => {
      result.current.setSortKey('name');
      result.current.setSortOrder('desc');
    });
    expect(result.current.filteredServers.map((s) => s.name)).toEqual(['Bravo', 'Alpha']);
  });

  it('filters servers only from its explicit local query', () => {
    const { result } = renderHook(() => useServers(servers, contacts, 'BRAVO'));

    expect(result.current.filteredServers.map((server) => server.name)).toEqual(['Bravo']);
  });

  it('opens context menu and clears it on global click', () => {
    const { result } = renderHook(() => useServers(servers, contacts));

    const event = {
      preventDefault: vi.fn(),
      clientX: 12,
      clientY: 34,
    } as unknown as ReactMouseEvent;

    act(() => {
      result.current.handleContextMenu(event, servers[0]);
    });

    expect(result.current.contextMenu?.server.name).toBe('Alpha');

    act(() => {
      globalThis.dispatchEvent(new MouseEvent('click'));
    });
    expect(result.current.contextMenu).toBeNull();
  });

  it('handles edit flows and modal helpers', async () => {
    mockDeleteServer.mockResolvedValue(undefined);

    const { result } = renderHook(() => useServers(servers, contacts));

    act(() => {
      result.current.setContextMenu({ x: 2, y: 2, server: servers[1] });
    });
    act(() => {
      result.current.handleEdit();
    });
    expect(result.current.isAddModalOpen).toBe(true);
    expect(result.current.editingServer?.name).toBe('Bravo');

    act(() => {
      result.current.openAddModal();
    });
    expect(result.current.isAddModalOpen).toBe(true);
    expect(result.current.editingServer).toBeUndefined();
  });

  it('reports a rejected delete and shows the server again', async () => {
    // No realtime event fires for a rejected delete, so swallowing it would make the
    // row silently come back as if the delete had undone itself.
    mockDeleteServer.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useServers(servers, contacts));

    act(() => result.current.requestDeleteServer(servers[0]));
    const undoToast = mockShowToast.mock.calls.at(-1)?.[2] as { onDismiss: () => void };
    await act(async () => undoToast.onDismiss());

    expect(mockDeleteServer).toHaveBeenCalledWith('pb-1');
    await vi.waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Couldn't delete Alpha. Boom. It is back in the list. Try again.",
        'error',
      ),
    );
    await vi.waitFor(() =>
      expect(result.current.filteredServers.map((server) => server.name)).toContain('Alpha'),
    );
  });
});
