import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useDirectory } from '../useDirectory';
import { NoopToastProvider } from '../../components/Toast';
import type { Contact, BridgeGroup } from '@shared/ipc';

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    directory: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeContact = (email: string, name?: string, title?: string): Contact => ({
  name: name || email.split('@')[0],
  email,
  phone: '',
  title: title || '',
  _searchString: `${name || email.split('@')[0]} ${email} ${title || ''}`.toLowerCase(),
  raw: {},
});

const makeGroup = (id: string, name: string, emails: string[]): BridgeGroup => ({
  id,
  name,
  contacts: emails,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('useDirectory', () => {
  const contacts = [
    makeContact('alice@test.com', 'Alice Adams', 'Engineer'),
    makeContact('bob@test.com', 'Bob Baker', 'Manager'),
    makeContact('charlie@test.com', 'Charlie Clark', 'Director'),
  ];

  const groups = [
    makeGroup('g1', 'Engineering', ['alice@test.com', 'bob@test.com']),
    makeGroup('g2', 'Leadership', ['charlie@test.com']),
  ];

  const onAddToAssembler = vi.fn();

  const mockApi = {
    addContact: vi.fn(),
    removeContact: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (window as Window & { api: typeof mockApi }).api = mockApi as Window['api'];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns all contacts when no search is active', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    expect(result.current.filtered).toHaveLength(3);
  });

  it('filters contacts by search after debounce', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.setSearch('alice');
    });

    // Before debounce, still shows all
    expect(result.current.filtered).toHaveLength(3);

    // Advance past debounce delay (300ms)
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].email).toBe('alice@test.com');
  });

  it('search is case insensitive', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.setSearch('BOB');
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].email).toBe('bob@test.com');
  });

  it('sorts by name ascending by default', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    const names = result.current.filtered.map((c) => c.name);
    expect(names).toEqual(['Alice Adams', 'Bob Baker', 'Charlie Clark']);
  });

  it('toggles sort direction on same key', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.handleSort('name'); // Toggle to desc
    });

    expect(result.current.sortConfig).toEqual({ key: 'name', direction: 'desc' });
    const names = result.current.filtered.map((c) => c.name);
    expect(names).toEqual(['Charlie Clark', 'Bob Baker', 'Alice Adams']);
  });

  it('switches to new sort key with ascending direction', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.handleSort('title');
    });

    expect(result.current.sortConfig).toEqual({ key: 'title', direction: 'asc' });
    const titles = result.current.filtered.map((c) => c.title);
    expect(titles).toEqual(['Director', 'Engineer', 'Manager']);
  });

  it('sorts by groups and verifies order', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.handleSort('groups');
    });

    expect(result.current.sortConfig).toEqual({ key: 'groups', direction: 'asc' });
    const emails = result.current.filtered.map((c) => c.email);
    // alice is in Engineering, bob is in Engineering, charlie is in Leadership
    // Ascending: Engineering < Leadership
    expect(emails).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
  });

  it('builds groupMap from groups prop', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    expect(result.current.groupMap.get('alice@test.com')).toEqual(['Engineering']);
    expect(result.current.groupMap.get('charlie@test.com')).toEqual(['Leadership']);
  });

  it('tracks recently added contacts with auto-clear', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.handleAddWrapper(contacts[0]);
    });

    expect(onAddToAssembler).toHaveBeenCalledWith(contacts[0]);
    expect(result.current.recentlyAdded.has('alice@test.com')).toBe(true);

    // Auto-clears after RECENTLY_ADDED_RESET_MS (2000ms)
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(result.current.recentlyAdded.has('alice@test.com')).toBe(false);
  });

  it('replaces timeout for duplicate recently added', () => {
    const { result } = renderHook(() => useDirectory(contacts, groups, onAddToAssembler), {
      wrapper,
    });

    act(() => {
      result.current.handleAddWrapper(contacts[0]);
    });

    // Advance 1500ms (still within 2000ms timeout)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.recentlyAdded.has('alice@test.com')).toBe(true);

    // Re-add the same contact — should reset timeout
    act(() => {
      result.current.handleAddWrapper(contacts[0]);
    });

    // Advance 1500ms more — first timeout would have fired, but second hasn't
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.recentlyAdded.has('alice@test.com')).toBe(true);

    // Advance past second timeout
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.recentlyAdded.has('alice@test.com')).toBe(false);
  });
});
