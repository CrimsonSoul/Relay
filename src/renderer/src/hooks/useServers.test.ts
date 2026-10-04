import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Server, Contact } from '@shared/ipc';

vi.mock('../services/serverService', () => ({
  addServer: vi.fn(() => Promise.resolve({})),
  deleteServer: vi.fn(() => Promise.resolve()),
}));

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
import { secureStorage } from '../utils/secureStorage';

import { useServers } from './useServers';
import {
  addServer as pbAddServer,
  deleteServer as pbDeleteServer,
} from '../services/serverService';
import type { ToastOptions } from '../components/Toast';

const mockedPbAddServer = vi.mocked(pbAddServer);
const mockedPbDeleteServer = vi.mocked(pbDeleteServer);

/** The Undo toast raised by the latest delete request. */
const lastUndoToast = (): Required<Pick<ToastOptions, 'action' | 'onDismiss'>> => {
  const options = mockShowToast.mock.calls.findLast(([, , opts]) => opts?.onDismiss)?.[2];
  if (!options) throw new Error('No undo toast was shown');
  return options;
};

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    name: 'server-a',
    businessArea: 'finance',
    lob: 'trading',
    comment: '',
    owner: 'alice@test.com',
    contact: 'bob@test.com',
    os: 'linux',
    _searchString: 'server-a finance trading alice@test.com bob@test.com linux',
    raw: { id: 'srv-1' },
    ...overrides,
  };
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    name: 'Alice',
    email: 'alice@test.com',
    phone: '555-1234',
    title: 'Engineer',
    _searchString: 'alice alice@test.com',
    raw: { id: 'c-1' },
    ...overrides,
  };
}

describe('useServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secureStorage.clear();
  });

  it('restores the server sort key and order after a remount', () => {
    const servers = [
      makeServer({ name: 'Alpha', owner: 'zed@test.com', _searchString: 'alpha' }),
      makeServer({ name: 'Zeta', owner: 'amy@test.com', _searchString: 'zeta' }),
    ];
    const first = renderHook(() => useServers(servers, []));
    act(() => {
      first.result.current.setSortKey('owner');
      first.result.current.setSortOrder('desc');
    });
    first.unmount();

    const second = renderHook(() => useServers(servers, []));
    expect(second.result.current.sortKey).toBe('owner');
    expect(second.result.current.sortOrder).toBe('desc');
    expect(second.result.current.filteredServers[0]?.name).toBe('Alpha');
  });

  // --- contactLookup branches ---

  it('builds contactLookup from contacts with email and name', () => {
    const contacts = [makeContact({ name: 'Alice', email: 'alice@test.com' })];
    const { result } = renderHook(() => useServers([], contacts));

    expect(result.current.contactLookup.get('alice@test.com')).toBeDefined();
    expect(result.current.contactLookup.get('alice')).toBeDefined();
  });

  it('builds contactLookup skipping missing email', () => {
    const contacts = [makeContact({ name: 'Bob', email: '' })];
    const { result } = renderHook(() => useServers([], contacts));

    // name is set, email is empty string (falsy) so not set
    expect(result.current.contactLookup.get('bob')).toBeDefined();
    expect(result.current.contactLookup.size).toBe(1);
  });

  it('builds contactLookup skipping missing name', () => {
    const contacts = [makeContact({ name: '', email: 'only@test.com' })];
    const { result } = renderHook(() => useServers([], contacts));

    expect(result.current.contactLookup.get('only@test.com')).toBeDefined();
    expect(result.current.contactLookup.size).toBe(1);
  });

  // --- filteredServers search + sort branches ---

  it('filters servers by its explicit local query', () => {
    const servers = [
      makeServer({ name: 'server-a', _searchString: 'server-a' }),
      makeServer({ name: 'server-b', _searchString: 'server-b' }),
    ];
    const { result } = renderHook(() => useServers(servers, [], 'server-a'));

    expect(result.current.filteredServers).toHaveLength(1);
    expect(result.current.filteredServers[0]?.name).toBe('server-a');
  });

  it('sorts servers ascending by default', () => {
    const servers = [
      makeServer({ name: 'Zeta', _searchString: 'zeta' }),
      makeServer({ name: 'Alpha', _searchString: 'alpha' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    expect(result.current.filteredServers[0]?.name).toBe('Alpha');
    expect(result.current.filteredServers[1]?.name).toBe('Zeta');
  });

  it('sorts servers descending when sortOrder is desc', () => {
    const servers = [
      makeServer({ name: 'Alpha', _searchString: 'alpha' }),
      makeServer({ name: 'Zeta', _searchString: 'zeta' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => {
      result.current.setSortOrder('desc');
    });

    expect(result.current.filteredServers[0]?.name).toBe('Zeta');
    expect(result.current.filteredServers[1]?.name).toBe('Alpha');
  });

  it('handles sort when values are equal', () => {
    const servers = [
      makeServer({ name: 'same', _searchString: 'same' }),
      makeServer({ name: 'same', _searchString: 'same' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    expect(result.current.filteredServers).toHaveLength(2);
  });

  it('handles sort with empty/undefined sortKey values', () => {
    const servers = [
      makeServer({ name: '', _searchString: '' }),
      makeServer({ name: 'Alpha', _searchString: 'alpha' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    // Empty string sorts before 'Alpha'
    expect(result.current.filteredServers[0]?.name).toBe('');
  });

  // --- contextMenu effect (click to dismiss) ---

  it('clears contextMenu on global click', () => {
    const server = makeServer();
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    // Open context menu
    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 100, clientY: 200 },
        server,
      );
    });
    expect(result.current.contextMenu).not.toBeNull();

    // Simulate global click
    act(() => {
      globalThis.dispatchEvent(new Event('click'));
    });
    expect(result.current.contextMenu).toBeNull();
  });

  it('does not add listener when contextMenu is null', () => {
    const addSpy = vi.spyOn(globalThis, 'addEventListener');
    renderHook(() => useServers([], []));

    // No context menu, so no click listener added (beyond any initial)
    const clickListenerCalls = addSpy.mock.calls.filter((c) => c[0] === 'click');
    expect(clickListenerCalls).toHaveLength(0);
    addSpy.mockRestore();
  });

  // --- handleEdit branches ---

  it('handleEdit sets editing server and opens modal when contextMenu exists', () => {
    const server = makeServer();
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 10, clientY: 20 },
        server,
      );
    });

    act(() => {
      result.current.handleEdit();
    });

    expect(result.current.editingServer).toBe(server);
    expect(result.current.isAddModalOpen).toBe(true);
    expect(result.current.contextMenu).toBeNull();
  });

  it('handleEdit does nothing when contextMenu is null', () => {
    const { result } = renderHook(() => useServers([], []));

    act(() => {
      result.current.handleEdit();
    });

    expect(result.current.editingServer).toBeUndefined();
    expect(result.current.isAddModalOpen).toBe(false);
  });

  // --- requestDeleteServer: undo window, then commit ---

  it('hides the server at once and deletes it only when the Undo toast closes', async () => {
    const server = makeServer({ raw: { id: 'srv-direct' } });
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => result.current.requestDeleteServer(server));

    expect(result.current.filteredServers).toEqual([]);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Deleted server-a',
      'info',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );
    expect(mockedPbDeleteServer).not.toHaveBeenCalled();

    await act(async () => lastUndoToast().onDismiss());
    await vi.waitFor(() => expect(mockedPbDeleteServer).toHaveBeenCalledWith('srv-direct'));
    expect(result.current.filteredServers).toEqual([]);
  });

  it('Undo inside the window restores the row without writing anything', () => {
    const server = makeServer();
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => result.current.requestDeleteServer(server));
    act(() => lastUndoToast().action.onClick());

    expect(result.current.filteredServers).toEqual([server]);
    expect(mockedPbDeleteServer).not.toHaveBeenCalled();
    expect(mockedPbAddServer).not.toHaveBeenCalled();
  });

  it('re-creates a server whose delete committed on unmount when Undo arrives later', async () => {
    const server = makeServer({ comment: 'primary' });
    const servers = [server];
    const { result, unmount } = renderHook(() => useServers(servers, []));

    act(() => result.current.requestDeleteServer(server));
    const undoToast = lastUndoToast();
    unmount();

    await vi.waitFor(() => expect(mockedPbDeleteServer).toHaveBeenCalledWith('srv-1'));
    undoToast.action.onClick();
    await vi.waitFor(() =>
      expect(mockedPbAddServer).toHaveBeenCalledWith({
        name: 'server-a',
        businessArea: 'finance',
        lob: 'trading',
        comment: 'primary',
        owner: 'alice@test.com',
        contact: 'bob@test.com',
        os: 'linux',
      }),
    );
  });

  it('reports a server without a saved record instead of pretending to delete it', async () => {
    const server = makeServer({ raw: {} });
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => result.current.requestDeleteServer(server));
    await act(async () => lastUndoToast().onDismiss());

    expect(mockedPbDeleteServer).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(result.current.filteredServers).toEqual([server]));
    expect(mockShowToast).toHaveBeenCalledWith(
      "Couldn't delete server-a. It has no saved record yet. It is back in the list. Wait for the list to refresh before trying again.",
      'error',
    );
  });

  it('brings the row back and reports a rejected delete', async () => {
    // A rejected delete emits no realtime event, so it must surface; otherwise the row
    // would just reappear with no explanation.
    mockedPbDeleteServer.mockRejectedValueOnce(new Error('fail'));
    const server = makeServer({ raw: { id: 'srv-fail' } });
    const servers = [server];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => result.current.requestDeleteServer(server));
    await act(async () => lastUndoToast().onDismiss());

    await vi.waitFor(() => expect(result.current.filteredServers).toEqual([server]));
    expect(mockShowToast).toHaveBeenCalledWith(
      "Couldn't delete server-a. Fail. It is back in the list. Try again.",
      'error',
    );
  });

  // --- openAddModal / editServer ---

  it('openAddModal clears editingServer and opens modal', () => {
    const { result } = renderHook(() => useServers([], []));

    act(() => {
      result.current.openAddModal();
    });

    expect(result.current.editingServer).toBeUndefined();
    expect(result.current.isAddModalOpen).toBe(true);
  });

  it('editServer sets server and opens modal', () => {
    const server = makeServer();
    const { result } = renderHook(() => useServers([], []));

    act(() => {
      result.current.editServer(server);
    });

    expect(result.current.editingServer).toBe(server);
    expect(result.current.isAddModalOpen).toBe(true);
  });
});
