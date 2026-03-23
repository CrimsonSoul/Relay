import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSavedLocations } from '../useSavedLocations';

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    location: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    api: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock useCollection
const mockRefetch = vi.fn();
const mockCollectionData = { current: [] as unknown[] };
vi.mock('../useCollection', () => ({
  useCollection: () => ({
    data: mockCollectionData.current,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

// Mock PocketBase saved location service
const mockAddLocation = vi.fn();
const mockUpdateLocation = vi.fn();
const mockDeleteLocation = vi.fn();
const mockSetDefaultLocation = vi.fn();
vi.mock('../../services/savedLocationService', () => ({
  addLocation: (...args: unknown[]) => mockAddLocation(...args),
  updateLocation: (...args: unknown[]) => mockUpdateLocation(...args),
  deleteLocation: (...args: unknown[]) => mockDeleteLocation(...args),
  setDefaultLocation: (...args: unknown[]) => mockSetDefaultLocation(...args),
}));

const makeRecord = (id: string, name: string, lat: number, lon: number, isDefault: boolean) => ({
  id,
  name,
  lat,
  lon,
  isDefault,
  created: '2026-01-01T00:00:01Z',
  updated: '2026-01-01T00:00:01Z',
});

describe('useSavedLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionData.current = [
      makeRecord('1', 'Austin, TX', 30.2, -97.7, true),
      makeRecord('2', 'Denver, CO', 39.7, -104.9, false),
    ];
  });

  it('loads locations from useCollection and exposes default location', () => {
    const { result } = renderHook(() => useSavedLocations());

    expect(result.current.loading).toBe(false);
    expect(result.current.locations).toHaveLength(2);
    expect(result.current.getDefaultLocation()?.id).toBe('1');
  });

  it('saves a location via PocketBase service', async () => {
    const savedRecord = makeRecord('3', 'Seattle, WA', 47.6, -122.3, true);
    mockAddLocation.mockResolvedValue(savedRecord);

    const { result } = renderHook(() => useSavedLocations());

    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveLocation({
        name: 'Seattle, WA',
        lat: 47.6,
        lon: -122.3,
        isDefault: true,
      });
    });

    expect(saved).not.toBeNull();
    expect(mockAddLocation).toHaveBeenCalled();
  });

  it('returns null when saveLocation fails', async () => {
    mockAddLocation.mockRejectedValue(new Error('save-fail'));

    const { result } = renderHook(() => useSavedLocations());

    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveLocation({
        name: 'Nowhere',
        lat: 0,
        lon: 0,
        isDefault: false,
      });
    });

    expect(saved).toBeNull();
  });

  it('updates a location via PocketBase service', async () => {
    mockUpdateLocation.mockResolvedValue({ id: '1', name: 'Austin, Texas' });

    const { result } = renderHook(() => useSavedLocations());

    let success = false;
    await act(async () => {
      success = await result.current.updateLocation('1', { name: 'Austin, Texas' });
    });

    expect(success).toBe(true);
    expect(mockUpdateLocation).toHaveBeenCalledWith('1', { name: 'Austin, Texas' });
  });

  it('returns false when updateLocation fails', async () => {
    mockUpdateLocation.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSavedLocations());

    let success = true;
    await act(async () => {
      success = await result.current.updateLocation('2', { name: 'Broken' });
    });

    expect(success).toBe(false);
  });

  it('deletes a location via PocketBase service', async () => {
    mockDeleteLocation.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSavedLocations());

    let success = false;
    await act(async () => {
      success = await result.current.deleteLocation('1');
    });

    expect(success).toBe(true);
    expect(mockDeleteLocation).toHaveBeenCalledWith('1');
  });

  it('returns false when deleteLocation fails', async () => {
    mockDeleteLocation.mockRejectedValue(new Error('delete-fail'));

    const { result } = renderHook(() => useSavedLocations());

    let success = true;
    await act(async () => {
      success = await result.current.deleteLocation('1');
    });

    expect(success).toBe(false);
  });

  it('sets default location via PocketBase service', async () => {
    mockSetDefaultLocation.mockResolvedValue({ id: '2', isDefault: true });

    const { result } = renderHook(() => useSavedLocations());

    let success = false;
    await act(async () => {
      success = await result.current.setDefaultLocation('2');
    });

    expect(success).toBe(true);
    expect(mockSetDefaultLocation).toHaveBeenCalledWith('2');
  });

  it('returns false when setDefaultLocation fails', async () => {
    mockSetDefaultLocation.mockRejectedValue(new Error('setdefault-fail'));

    const { result } = renderHook(() => useSavedLocations());

    let success = true;
    await act(async () => {
      success = await result.current.setDefaultLocation('1');
    });

    expect(success).toBe(false);
  });

  it('clears default location via PocketBase updateLocation', async () => {
    mockUpdateLocation.mockResolvedValue({ id: '1', isDefault: false });

    const { result } = renderHook(() => useSavedLocations());

    let success = false;
    await act(async () => {
      success = await result.current.clearDefaultLocation('1');
    });

    expect(success).toBe(true);
    expect(mockUpdateLocation).toHaveBeenCalledWith('1', { isDefault: false });
  });

  it('returns false when clearDefaultLocation fails', async () => {
    mockUpdateLocation.mockRejectedValue(new Error('clear-fail'));

    const { result } = renderHook(() => useSavedLocations());

    let success = true;
    await act(async () => {
      success = await result.current.clearDefaultLocation('1');
    });

    expect(success).toBe(false);
  });
});
