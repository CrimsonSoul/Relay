import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useServers } from '../useServers';
import type { Contact, Server } from '@shared/ipc';
import type { MouseEvent as ReactMouseEvent } from 'react';

describe('useServers', () => {
  const servers: Server[] = [
    {
      name: 'Alpha',
      businessArea: 'Finance',
      lob: 'Core',
      comment: '',
      owner: 'Owner A',
      contact: 'alpha@test.com',
      os: 'Linux',
      _searchString: 'alpha finance core owner a linux',
      raw: {},
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
      raw: {},
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
    (globalThis as Window & { api?: { removeServer: (name: string) => Promise<boolean> } }).api = {
      removeServer: vi.fn().mockResolvedValue(true),
    };
  });

  it('builds contact lookup and filters/sorts servers', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useServers(servers, contacts));

    expect(result.current.contactLookup.get('alpha@test.com')?.name).toBe('Alice');
    expect(result.current.contactLookup.get('alice')?.email).toBe('alpha@test.com');
    expect(result.current.filteredServers.map((s) => s.name)).toEqual(['Alpha', 'Bravo']);

    act(() => {
      result.current.setSearch('bravo');
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.filteredServers.map((s) => s.name)).toEqual(['Bravo']);

    act(() => {
      result.current.setSearch('');
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    act(() => {
      result.current.setSortKey('name');
      result.current.setSortOrder('desc');
    });
    expect(result.current.filteredServers.map((s) => s.name)).toEqual(['Bravo', 'Alpha']);

    vi.useRealTimers();
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

  it('handles delete/edit flows and modal helpers', async () => {
    const removeServer = vi.fn().mockResolvedValue(true);
    (globalThis as Window & { api?: { removeServer: (name: string) => Promise<boolean> } }).api = {
      removeServer,
    };

    const { result } = renderHook(() => useServers(servers, contacts));

    act(() => {
      result.current.setContextMenu({ x: 1, y: 1, server: servers[0] });
    });

    await act(async () => {
      await result.current.handleDelete();
    });
    expect(removeServer).toHaveBeenCalledWith('Alpha');
    expect(result.current.contextMenu).toBeNull();

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

  it('swallows server delete errors', async () => {
    const removeServer = vi.fn().mockRejectedValue(new Error('boom'));
    (globalThis as Window & { api?: { removeServer: (name: string) => Promise<boolean> } }).api = {
      removeServer,
    };

    const { result } = renderHook(() => useServers(servers, contacts));

    await act(async () => {
      await result.current.deleteServer(servers[0]);
    });

    expect(removeServer).toHaveBeenCalledWith('Alpha');
  });
});
