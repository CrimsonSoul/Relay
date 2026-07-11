import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useGroups } from '../useGroups';
import { NoopToastProvider } from '../../components/Toast';

vi.mock('../../utils/logger', () => ({
  loggers: {
    directory: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock useCollection
const mockUseCollection = vi.fn();
vi.mock('../useCollection', () => ({
  useCollection: () => mockUseCollection(),
}));

// Mock PocketBase bridge group service
const mockAddGroup = vi.fn();
const mockUpdateGroup = vi.fn();
const mockDeleteGroup = vi.fn();
vi.mock('../../services/bridgeGroupService', () => ({
  addGroup: (...args: unknown[]) => mockAddGroup(...args),
  updateGroup: (...args: unknown[]) => mockUpdateGroup(...args),
  deleteGroup: (...args: unknown[]) => mockDeleteGroup(...args),
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRecord = (id: string, name: string, contacts: string[]) => ({
  id,
  name,
  contacts,
  created: '2026-01-01T00:00:01Z',
  updated: '2026-01-01T00:00:01Z',
});

describe('useGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create a second bridge_groups subscription for mutation helpers', () => {
    renderHook(() => useGroups(), { wrapper });

    expect(mockUseCollection).not.toHaveBeenCalled();
  });

  it('saves a new group via PocketBase service', async () => {
    const newRecord = makeRecord('g3', 'Security', ['c@test.com']);
    mockAddGroup.mockResolvedValue(newRecord);

    const { result } = renderHook(() => useGroups(), { wrapper });

    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveGroup({ name: 'Security', contacts: ['c@test.com'] });
    });

    expect(saved).toBeDefined();
    expect(mockAddGroup).toHaveBeenCalledWith({ name: 'Security', contacts: ['c@test.com'] });
  });

  it('handles save group failure', async () => {
    mockAddGroup.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useGroups(), { wrapper });

    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveGroup({ name: 'Fail', contacts: [] });
    });

    expect(saved).toBeUndefined();
  });

  it('updates a group via PocketBase service', async () => {
    mockUpdateGroup.mockResolvedValue({ id: 'g1', name: 'Network Updated' });

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.updateGroup('g1', { name: 'Network Updated' });
    });

    expect(success).toBe(true);
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { name: 'Network Updated' });
  });

  it('returns false on update failure', async () => {
    mockUpdateGroup.mockRejectedValue(new Error('Update failed'));

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = true;
    await act(async () => {
      success = await result.current.updateGroup('g1', { name: 'Network Updated' });
    });

    expect(success).toBe(false);
  });

  it('deletes a group via PocketBase service', async () => {
    mockDeleteGroup.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.deleteGroup('g1');
    });

    expect(success).toBe(true);
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('returns false on delete failure', async () => {
    mockDeleteGroup.mockRejectedValue(new Error('Delete failed'));

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = true;
    await act(async () => {
      success = await result.current.deleteGroup('g1');
    });

    expect(success).toBe(false);
  });

  it('updates a group with contacts field', async () => {
    mockUpdateGroup.mockResolvedValue({ id: 'g1', name: 'Network', contacts: ['x@test.com'] });

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.updateGroup('g1', { contacts: ['x@test.com'] });
    });

    expect(success).toBe(true);
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { contacts: ['x@test.com'] });
  });

  it('updates a group with both name and contacts', async () => {
    mockUpdateGroup.mockResolvedValue({ id: 'g1', name: 'Renamed', contacts: ['y@test.com'] });

    const { result } = renderHook(() => useGroups(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.updateGroup('g1', {
        name: 'Renamed',
        contacts: ['y@test.com'],
      });
    });

    expect(success).toBe(true);
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', {
      name: 'Renamed',
      contacts: ['y@test.com'],
    });
  });
});
