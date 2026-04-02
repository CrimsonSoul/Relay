import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Server, Contact } from '@shared/ipc';

// Mock dependencies
vi.mock('../contexts/SearchContext', () => ({
  useSearchContext: vi.fn(() => ({ debouncedQuery: '' })),
}));

vi.mock('../services/serverService', () => ({
  deleteServer: vi.fn(() => Promise.resolve()),
}));

import { useServers } from './useServers';
import { useSearchContext } from '../contexts/SearchContext';
import { deleteServer as pbDeleteServer } from '../services/serverService';

const mockedUseSearchContext = vi.mocked(useSearchContext);
const mockedPbDeleteServer = vi.mocked(pbDeleteServer);

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
    mockedUseSearchContext.mockReturnValue({
      debouncedQuery: '',
      query: '',
      setQuery: vi.fn(),
      isSearchFocused: false,
      setIsSearchFocused: vi.fn(),
      searchInputRef: { current: null },
      focusSearch: vi.fn(),
      clearSearch: vi.fn(),
    });
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

  it('filters servers by debouncedSearch', () => {
    mockedUseSearchContext.mockReturnValue({
      debouncedQuery: 'server-a',
      query: 'server-a',
      setQuery: vi.fn(),
      isSearchFocused: false,
      setIsSearchFocused: vi.fn(),
      searchInputRef: { current: null },
      focusSearch: vi.fn(),
      clearSearch: vi.fn(),
    });

    const servers = [
      makeServer({ name: 'server-a', _searchString: 'server-a' }),
      makeServer({ name: 'server-b', _searchString: 'server-b' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    expect(result.current.filteredServers).toHaveLength(1);
    expect(result.current.filteredServers[0].name).toBe('server-a');
  });

  it('sorts servers ascending by default', () => {
    const servers = [
      makeServer({ name: 'Zeta', _searchString: 'zeta' }),
      makeServer({ name: 'Alpha', _searchString: 'alpha' }),
    ];
    const { result } = renderHook(() => useServers(servers, []));

    expect(result.current.filteredServers[0].name).toBe('Alpha');
    expect(result.current.filteredServers[1].name).toBe('Zeta');
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

    expect(result.current.filteredServers[0].name).toBe('Zeta');
    expect(result.current.filteredServers[1].name).toBe('Alpha');
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
    expect(result.current.filteredServers[0].name).toBe('');
  });

  // --- contextMenu effect (click to dismiss) ---

  it('clears contextMenu on global click', () => {
    const servers = [makeServer()];
    const { result } = renderHook(() => useServers(servers, []));

    // Open context menu
    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 100, clientY: 200 },
        servers[0],
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

  // --- handleDelete branches ---

  it('handleDelete deletes server when contextMenu has server with id', async () => {
    const servers = [makeServer({ raw: { id: 'srv-123' } })];
    const { result } = renderHook(() => useServers(servers, []));

    // Open context menu
    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 10, clientY: 20 },
        servers[0],
      );
    });

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockedPbDeleteServer).toHaveBeenCalledWith('srv-123');
    expect(result.current.contextMenu).toBeNull();
  });

  it('handleDelete does nothing when contextMenu is null', async () => {
    const { result } = renderHook(() => useServers([], []));

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockedPbDeleteServer).not.toHaveBeenCalled();
  });

  it('handleDelete skips pbDeleteServer when server has no id', async () => {
    const servers = [makeServer({ raw: {} })];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 10, clientY: 20 },
        servers[0],
      );
    });

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockedPbDeleteServer).not.toHaveBeenCalled();
    expect(result.current.contextMenu).toBeNull();
  });

  it('handleDelete catches errors gracefully', async () => {
    mockedPbDeleteServer.mockRejectedValueOnce(new Error('network error'));
    const servers = [makeServer({ raw: { id: 'srv-err' } })];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 10, clientY: 20 },
        servers[0],
      );
    });

    await act(async () => {
      await result.current.handleDelete();
    });

    // Should not throw, contextMenu cleared
    expect(result.current.contextMenu).toBeNull();
  });

  // --- handleEdit branches ---

  it('handleEdit sets editing server and opens modal when contextMenu exists', () => {
    const servers = [makeServer()];
    const { result } = renderHook(() => useServers(servers, []));

    act(() => {
      result.current.handleContextMenu(
        { preventDefault: vi.fn(), clientX: 10, clientY: 20 },
        servers[0],
      );
    });

    act(() => {
      result.current.handleEdit();
    });

    expect(result.current.editingServer).toBe(servers[0]);
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

  // --- deleteServer (direct) branches ---

  it('deleteServer deletes by server id', async () => {
    const { result } = renderHook(() => useServers([], []));

    await act(async () => {
      await result.current.deleteServer(makeServer({ raw: { id: 'srv-direct' } }));
    });

    expect(mockedPbDeleteServer).toHaveBeenCalledWith('srv-direct');
  });

  it('deleteServer skips when no server id', async () => {
    const { result } = renderHook(() => useServers([], []));

    await act(async () => {
      await result.current.deleteServer(makeServer({ raw: {} }));
    });

    expect(mockedPbDeleteServer).not.toHaveBeenCalled();
  });

  it('deleteServer catches errors', async () => {
    mockedPbDeleteServer.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useServers([], []));

    // Should not throw
    await act(async () => {
      await result.current.deleteServer(makeServer({ raw: { id: 'srv-fail' } }));
    });

    expect(mockedPbDeleteServer).toHaveBeenCalled();
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
