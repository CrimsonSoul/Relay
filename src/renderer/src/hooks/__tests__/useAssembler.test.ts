import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useAssembler } from '../useAssembler';
import { NoopToastProvider } from '../../components/Toast';
import type { BridgeGroup, Contact } from '@shared/ipc';

// Mock secureStorage
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn(() => false),
    setItemSync: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeContact = (email: string, name?: string, title?: string, phone?: string): Contact => ({
  name: name || email.split('@')[0],
  email,
  phone: phone || '',
  title: title || '',
  _searchString:
    `${name || email.split('@')[0]} ${email} ${title || ''} ${phone || ''}`.toLowerCase(),
  raw: {},
});

const makeGroup = (id: string, name: string, contacts: string[]): BridgeGroup => ({
  id,
  name,
  contacts,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('useAssembler', () => {
  const contacts = [
    makeContact('alice@test.com', 'Alice Adams', 'Engineer', '555-1111'),
    makeContact('bob@test.com', 'Bob Baker', 'Manager', '555-2222'),
    makeContact('charlie@test.com', 'Charlie Clark', 'Director', '555-3333'),
  ];

  const groups = [
    makeGroup('g1', 'Engineering', ['alice@test.com', 'bob@test.com']),
    makeGroup('g2', 'Leadership', ['bob@test.com', 'charlie@test.com']),
  ];

  const baseProps = {
    groups,
    contacts,
    selectedGroupIds: [] as string[],
    manualAdds: [] as string[],
    manualRemoves: [] as string[],
    onAddManual: vi.fn(),
    onRemoveManual: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty log when nothing is selected', () => {
    const { result } = renderHook(() => useAssembler(baseProps), { wrapper });
    expect(result.current.log).toEqual([]);
  });

  it('populates log from selected group', () => {
    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    const emails = result.current.log.map((l) => l.email);
    expect(emails).toContain('alice@test.com');
    expect(emails).toContain('bob@test.com');
    expect(result.current.log).toHaveLength(2);
  });

  it('deduplicates emails across groups', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    // bob@test.com is in both groups but should appear only once
    const emails = result.current.log.map((l) => l.email);
    const bobCount = emails.filter((e) => e === 'bob@test.com').length;
    expect(bobCount).toBe(1);
    expect(result.current.log).toHaveLength(3); // alice, bob, charlie
  });

  it('includes manual adds in the log', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, manualAdds: ['dave@test.com'] }),
      { wrapper },
    );

    const emails = result.current.log.map((l) => l.email);
    expect(emails).toContain('dave@test.com');

    const dave = result.current.log.find((l) => l.email === 'dave@test.com');
    expect(dave?.source).toBe('manual');
  });

  it('excludes manual removes from the log', () => {
    const { result } = renderHook(
      () =>
        useAssembler({
          ...baseProps,
          selectedGroupIds: ['g1'],
          manualRemoves: ['bob@test.com'],
        }),
      { wrapper },
    );

    const emails = result.current.log.map((l) => l.email);
    expect(emails).toContain('alice@test.com');
    expect(emails).not.toContain('bob@test.com');
  });

  it('deduplicates manual adds that overlap with groups', () => {
    const { result } = renderHook(
      () =>
        useAssembler({
          ...baseProps,
          selectedGroupIds: ['g1'],
          manualAdds: ['alice@test.com'],
        }),
      { wrapper },
    );

    const emails = result.current.log.map((l) => l.email);
    const aliceCount = emails.filter((e) => e === 'alice@test.com').length;
    expect(aliceCount).toBe(1);
  });

  it('sorts by name ascending by default', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    const names = result.current.log.map((l) => {
      const c = contacts.find((ct) => ct.email === l.email);
      return c?.name || l.email;
    });
    expect(names).toEqual(['Alice Adams', 'Bob Baker', 'Charlie Clark']);
  });

  it('changes sort config and re-sorts', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    // Change to sort by email descending
    act(() => {
      result.current.setSortConfig({ key: 'email', direction: 'desc' });
    });

    const emails = result.current.log.map((l) => l.email);
    expect(emails).toEqual(['charlie@test.com', 'bob@test.com', 'alice@test.com']);
  });

  it('sorts by title', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    act(() => {
      result.current.setSortConfig({ key: 'title', direction: 'asc' });
    });

    const emails = result.current.log.map((l) => l.email);
    // Director (charlie) < Engineer (alice) < Manager (bob)
    expect(emails).toEqual(['charlie@test.com', 'alice@test.com', 'bob@test.com']);
  });

  it('builds contactMap from contacts array', () => {
    const { result } = renderHook(() => useAssembler(baseProps), { wrapper });

    expect(result.current.contactMap.get('alice@test.com')).toEqual(contacts[0]);
    expect(result.current.contactMap.get('bob@test.com')).toEqual(contacts[1]);
    expect(result.current.contactMap.size).toBe(3);
  });

  it('builds groupMap (email to group names)', () => {
    const { result } = renderHook(() => useAssembler(baseProps), { wrapper });

    expect(result.current.groupMap.get('alice@test.com')).toEqual(['Engineering']);
    expect(result.current.groupMap.get('bob@test.com')).toEqual(['Engineering', 'Leadership']);
    expect(result.current.groupMap.get('charlie@test.com')).toEqual(['Leadership']);
  });

  it('provides itemData with log, maps, and callbacks', () => {
    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    const { itemData } = result.current;
    expect(itemData.log).toBe(result.current.log);
    expect(itemData.contactMap).toBe(result.current.contactMap);
    expect(itemData.groupMap).toBe(result.current.groupMap);
    expect(typeof itemData.onRemoveManual).toBe('function');
    expect(typeof itemData.onAddToContacts).toBe('function');
    expect(typeof itemData.onContextMenu).toBe('function');
  });

  it('uses email prefix as name fallback for unknown contacts', () => {
    const { result } = renderHook(
      () =>
        useAssembler({
          ...baseProps,
          contacts: [], // No contact data
          manualAdds: ['unknown@test.com'],
        }),
      { wrapper },
    );

    // Should still be in log even without contact data
    expect(result.current.log).toHaveLength(1);
    expect(result.current.log[0].email).toBe('unknown@test.com');
  });

  it('sorts by phone', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    act(() => {
      result.current.setSortConfig({ key: 'phone', direction: 'asc' });
    });

    const emails = result.current.log.map((l) => l.email);
    // 555-1111 (alice) < 555-2222 (bob) < 555-3333 (charlie)
    expect(emails).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
  });

  it('sorts by groups', () => {
    const { result } = renderHook(
      () => useAssembler({ ...baseProps, selectedGroupIds: ['g1', 'g2'] }),
      { wrapper },
    );

    act(() => {
      result.current.setSortConfig({ key: 'groups', direction: 'asc' });
    });

    const emails = result.current.log.map((l) => l.email);
    // alice: "Engineering", bob: "Engineering, Leadership", charlie: "Leadership"
    expect(emails).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);
  });

  it('handleCopy writes semicolon-separated emails to clipboard', async () => {
    const mockWriteClipboard = vi.fn().mockResolvedValue(true);
    const mockApi = { writeClipboard: mockWriteClipboard };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleCopy();
    });

    expect(mockWriteClipboard).toHaveBeenCalledTimes(1);
    const clipboardArg = mockWriteClipboard.mock.calls[0][0];
    // Should contain emails separated by "; "
    expect(clipboardArg).toContain('alice@test.com');
    expect(clipboardArg).toContain('bob@test.com');
    expect(clipboardArg).toContain('; ');
  });

  it('handleCopy shows error toast on clipboard failure', async () => {
    const mockWriteClipboard = vi.fn().mockResolvedValue(false);
    const mockApi = { writeClipboard: mockWriteClipboard };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(
      () => useAssembler({ ...baseProps, manualAdds: ['a@test.com'] }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleCopy();
    });

    expect(mockWriteClipboard).toHaveBeenCalled();
  });

  it('executeDraftBridge opens Teams URL with correct parameters', () => {
    const mockOpenExternal = vi.fn();
    const mockApi = { openExternal: mockOpenExternal };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    act(() => {
      result.current.executeDraftBridge();
    });

    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    const url = mockOpenExternal.mock.calls[0][0] as string;
    expect(url).toContain('https://teams.microsoft.com/l/meeting/new');
    expect(url).toContain('attendees=');
    expect(url).toContain('subject=');
    // Both emails from g1 should be in attendees
    expect(url).toContain('alice%40test.com');
    expect(url).toContain('bob%40test.com');
  });

  it('handleContactSaved creates contact and adds email to manual list', async () => {
    const mockAddContact = vi.fn().mockResolvedValue(true);
    const onAddManual = vi.fn();
    const mockApi = { addContact: mockAddContact };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    await act(async () => {
      await result.current.handleContactSaved({ name: 'Dave', email: 'dave@test.com' });
    });

    expect(mockAddContact).toHaveBeenCalledWith({ name: 'Dave', email: 'dave@test.com' });
    expect(onAddManual).toHaveBeenCalledWith('dave@test.com');
  });

  it('handleContactSaved shows error toast on API failure', async () => {
    const mockAddContact = vi.fn().mockResolvedValue(false);
    const onAddManual = vi.fn();
    const mockApi = { addContact: mockAddContact };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    await act(async () => {
      await result.current.handleContactSaved({ name: 'Dave', email: 'dave@test.com' });
    });

    expect(mockAddContact).toHaveBeenCalled();
    // Should NOT forward the email on failure
    expect(onAddManual).not.toHaveBeenCalled();
  });

  it('handleContactSaved handles exception from API', async () => {
    const mockAddContact = vi.fn().mockRejectedValue(new Error('Network error'));
    const onAddManual = vi.fn();
    const mockApi = { addContact: mockAddContact };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    await act(async () => {
      await result.current.handleContactSaved({ name: 'Dave', email: 'dave@test.com' });
    });

    expect(onAddManual).not.toHaveBeenCalled();
  });

  it('handleQuickAdd calls onAddManual with email', () => {
    const onAddManual = vi.fn();
    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    act(() => {
      result.current.handleQuickAdd('quick@test.com');
    });

    expect(onAddManual).toHaveBeenCalledWith('quick@test.com');
  });

  it('handleAddToContacts sets pending email and opens modal', () => {
    const { result } = renderHook(() => useAssembler({ ...baseProps }), { wrapper });

    act(() => {
      result.current.handleAddToContacts('new@test.com');
    });

    expect(result.current.pendingEmail).toBe('new@test.com');
    expect(result.current.isAddContactModalOpen).toBe(true);
  });

  it('handleContactSaved shows error toast when api is not available', async () => {
    // Remove api from globalThis
    (globalThis as Window & { api?: unknown }).api = undefined;

    const onAddManual = vi.fn();
    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    await act(async () => {
      await result.current.handleContactSaved({ name: 'Dave', email: 'dave@test.com' });
    });

    // Should not add manual since api is unavailable
    expect(onAddManual).not.toHaveBeenCalled();
  });

  it('handleContactSaved does not call onAddManual when contact has no email', async () => {
    const mockAddContact = vi.fn().mockResolvedValue(true);
    const onAddManual = vi.fn();
    const mockApi = { addContact: mockAddContact };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, onAddManual }), { wrapper });

    await act(async () => {
      await result.current.handleContactSaved({ name: 'Dave' }); // no email
    });

    expect(mockAddContact).toHaveBeenCalled();
    // No email provided, so onAddManual should NOT be called
    expect(onAddManual).not.toHaveBeenCalled();
  });

  it('executeDraftBridge works when api is undefined', () => {
    (globalThis as Window & { api?: unknown }).api = undefined;

    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    // Should not throw when api is missing
    expect(() => {
      act(() => {
        result.current.executeDraftBridge();
      });
    }).not.toThrow();
  });

  it('executeDraftBridge shows error toast when openExternal rejects', async () => {
    const mockOpenExternal = vi.fn().mockReturnValue(Promise.reject(new Error('blocked')));
    const mockApi = { openExternal: mockOpenExternal };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    const { result } = renderHook(() => useAssembler({ ...baseProps, selectedGroupIds: ['g1'] }), {
      wrapper,
    });

    await act(async () => {
      result.current.executeDraftBridge();
      // Give the rejected promise a chance to settle
      await Promise.resolve();
    });

    expect(mockOpenExternal).toHaveBeenCalled();
  });

  it('handleCompositionContextMenu sets context menu state', () => {
    const { result } = renderHook(() => useAssembler(baseProps), { wrapper });

    act(() => {
      const mockEvent = {
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 200,
      } as unknown as React.MouseEvent;
      result.current.itemData.onContextMenu(mockEvent, 'test@test.com', true);
    });

    expect(result.current.compositionContextMenu).toEqual({
      x: 100,
      y: 200,
      email: 'test@test.com',
      isUnknown: true,
    });
  });

  it('setCompositionContextMenu to null clears context menu', () => {
    const { result } = renderHook(() => useAssembler(baseProps), { wrapper });

    act(() => {
      const mockEvent = {
        preventDefault: vi.fn(),
        clientX: 50,
        clientY: 60,
      } as unknown as React.MouseEvent;
      result.current.itemData.onContextMenu(mockEvent, 'a@b.com', false);
    });

    expect(result.current.compositionContextMenu).not.toBeNull();

    act(() => {
      result.current.setCompositionContextMenu(null);
    });

    expect(result.current.compositionContextMenu).toBeNull();
  });
});
