import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSavedLocations } from '../useSavedLocations';

vi.mock('../../utils/logger', () => ({
  loggers: {
    location: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    api: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

describe('useSavedLocations', () => {
  const initial = [
    { id: '1', name: 'Austin, TX', latitude: 30.2, longitude: -97.7, isDefault: true },
    { id: '2', name: 'Denver, CO', latitude: 39.7, longitude: -104.9, isDefault: false },
  ];

  const mockApi = {
    getSavedLocations: vi.fn(),
    saveLocation: vi.fn(),
    deleteLocation: vi.fn(),
    setDefaultLocation: vi.fn(),
    clearDefaultLocation: vi.fn(),
    updateLocation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getSavedLocations.mockResolvedValue(initial);
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
  });

  it('loads locations on mount and exposes default location', async () => {
    const { result } = renderHook(() => useSavedLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locations).toEqual(initial);
    expect(result.current.getDefaultLocation()?.id).toBe('1');
  });

  it('saves, updates, sets default, clears default, and deletes locations', async () => {
    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const saved = {
      id: '3',
      name: 'Seattle, WA',
      latitude: 47.6,
      longitude: -122.3,
      isDefault: true,
    };

    mockApi.saveLocation.mockResolvedValue(saved);
    mockApi.updateLocation.mockResolvedValue(true);
    mockApi.setDefaultLocation.mockResolvedValue(true);
    mockApi.clearDefaultLocation.mockResolvedValue(true);
    mockApi.deleteLocation.mockResolvedValue(true);

    await act(async () => {
      await result.current.saveLocation({
        name: saved.name,
        latitude: saved.latitude,
        longitude: saved.longitude,
        isDefault: saved.isDefault,
      });
    });

    expect(result.current.locations.find((l) => l.id === '1')?.isDefault).toBe(false);
    expect(result.current.locations.find((l) => l.id === '3')?.isDefault).toBe(true);

    await act(async () => {
      await result.current.updateLocation('3', { name: 'Seattle, Washington' });
    });
    expect(result.current.locations.find((l) => l.id === '3')?.name).toBe('Seattle, Washington');

    await act(async () => {
      await result.current.setDefaultLocation('2');
    });
    expect(result.current.locations.find((l) => l.id === '2')?.isDefault).toBe(true);

    await act(async () => {
      await result.current.clearDefaultLocation('2');
    });
    expect(result.current.locations.find((l) => l.id === '2')?.isDefault).toBe(false);

    await act(async () => {
      await result.current.deleteLocation('1');
    });
    expect(result.current.locations.find((l) => l.id === '1')).toBeUndefined();
  });

  it('returns fallback values when API is missing or methods throw', async () => {
    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis as Window & { api?: typeof mockApi }).api = undefined;

    let saveResult: unknown;
    let deleteResult = true;
    let setDefaultResult = true;
    await act(async () => {
      saveResult = await result.current.saveLocation({
        name: 'Nowhere',
        latitude: 0,
        longitude: 0,
        isDefault: false,
      });
      deleteResult = await result.current.deleteLocation('x');
      setDefaultResult = await result.current.setDefaultLocation('x');
    });

    expect(saveResult).toBeNull();
    expect(deleteResult).toBe(false);
    expect(setDefaultResult).toBe(false);

    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
    mockApi.updateLocation.mockRejectedValue(new Error('boom'));

    let updateResult = true;
    await act(async () => {
      updateResult = await result.current.updateLocation('2', { name: 'Broken' });
    });
    expect(updateResult).toBe(false);
  });

  it('saveLocation appends without clearing defaults when isDefault is false', async () => {
    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const saved = {
      id: '3',
      name: 'Dallas, TX',
      latitude: 32.7,
      longitude: -96.7,
      isDefault: false,
    };
    mockApi.saveLocation.mockResolvedValue(saved);

    await act(async () => {
      await result.current.saveLocation({
        name: saved.name,
        latitude: saved.latitude,
        longitude: saved.longitude,
        isDefault: false,
      });
    });

    // Existing default (id=1) should remain default
    expect(result.current.locations.find((l) => l.id === '1')?.isDefault).toBe(true);
    // New location appended
    expect(result.current.locations.find((l) => l.id === '3')?.name).toBe('Dallas, TX');
  });

  it('catch paths return false/null for saveLocation, deleteLocation, setDefaultLocation, clearDefaultLocation', async () => {
    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.saveLocation.mockRejectedValue(new Error('save-fail'));
    mockApi.deleteLocation.mockRejectedValue(new Error('delete-fail'));
    mockApi.setDefaultLocation.mockRejectedValue(new Error('setdefault-fail'));
    mockApi.clearDefaultLocation.mockRejectedValue(new Error('cleardefault-fail'));

    let saveRes: unknown;
    let deleteRes = true;
    let setDefaultRes = true;
    let clearDefaultRes = true;

    await act(async () => {
      saveRes = await result.current.saveLocation({
        name: 'X',
        latitude: 0,
        longitude: 0,
        isDefault: false,
      });
      deleteRes = await result.current.deleteLocation('1');
      setDefaultRes = await result.current.setDefaultLocation('1');
      clearDefaultRes = await result.current.clearDefaultLocation('1');
    });

    expect(saveRes).toBeNull();
    expect(deleteRes).toBe(false);
    expect(setDefaultRes).toBe(false);
    expect(clearDefaultRes).toBe(false);
  });

  it('clearDefaultLocation and updateLocation return false when API not available', async () => {
    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis as Window & { api?: typeof mockApi }).api = undefined;

    let clearRes = true;
    let updateRes = true;
    await act(async () => {
      clearRes = await result.current.clearDefaultLocation('1');
      updateRes = await result.current.updateLocation('1', { name: 'New Name' });
    });

    expect(clearRes).toBe(false);
    expect(updateRes).toBe(false);
  });

  it('loadLocations logs error when getSavedLocations throws', async () => {
    const { loggers } = await import('../../utils/logger');
    mockApi.getSavedLocations.mockRejectedValue(new Error('load-fail'));

    const { result } = renderHook(() => useSavedLocations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loggers.location.error).toHaveBeenCalledWith(
      'Failed to load saved locations',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(result.current.locations).toEqual([]);
  });
});
