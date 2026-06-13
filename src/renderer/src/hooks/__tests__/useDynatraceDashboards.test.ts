import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import { useDynatraceDashboards } from '../useDynatraceDashboards';

type DynatraceBridgeApi = Pick<
  NonNullable<typeof globalThis.api>,
  | 'listDynatraceDashboards'
  | 'addDynatraceDashboard'
  | 'updateDynatraceDashboard'
  | 'removeDynatraceDashboard'
  | 'openDynatraceDashboard'
  | 'clearDynatraceSession'
  | 'onDynatraceDashboardsChanged'
>;

const live: DynatraceDashboardState = {
  id: 'dt_1',
  name: 'NOC',
  url: 'https://abc.live.dynatrace.com/dashboard',
  state: 'live',
};

const auth: DynatraceDashboardState = { ...live, state: 'authenticating' };
const blocked: DynatraceDashboardState = { ...live, state: 'blocked' };
const updated: DynatraceDashboardState = { ...live, name: 'NOC Updated' };
const added: DynatraceDashboardState = {
  id: 'dt_2',
  name: 'APM',
  url: 'https://apps.dynatrace.com/dashboard/apm',
  state: 'live',
};

const input: DynatraceDashboardInput = {
  name: 'APM',
  url: 'https://apps.dynatrace.com/dashboard/apm',
};

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useDynatraceDashboards', () => {
  let listener: ((dashboards: DynatraceDashboardState[]) => void) | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let api: DynatraceBridgeApi;
  const showToast = vi.fn();

  function installApi(nextApi: DynatraceBridgeApi): void {
    globalThis.api = nextApi as typeof globalThis.api;
    globalThis.window.api = nextApi as typeof globalThis.api;
  }

  function removeApi(): void {
    globalThis.api = undefined;
    globalThis.window.api = undefined;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    unsubscribe = vi.fn();
    api = {
      listDynatraceDashboards: vi.fn().mockResolvedValue([live]),
      addDynatraceDashboard: vi.fn().mockResolvedValue({ success: true, data: added }),
      updateDynatraceDashboard: vi.fn().mockResolvedValue({ success: true, data: updated }),
      removeDynatraceDashboard: vi.fn().mockResolvedValue({ success: true }),
      openDynatraceDashboard: vi.fn().mockResolvedValue(true),
      clearDynatraceSession: vi.fn().mockResolvedValue({ success: true }),
      onDynatraceDashboardsChanged: vi.fn((callback) => {
        listener = callback;
        return unsubscribe;
      }),
    };
    installApi(api);
  });

  afterEach(() => {
    removeApi();
  });

  it('loads dashboards from the bridge API on mount', async () => {
    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.dashboards).toEqual([live]);
      expect(result.current.loading).toBe(false);
    });
    expect(api.listDynatraceDashboards).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('applies subscription updates and unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => expect(listener).toBeTypeOf('function'));

    act(() => {
      listener?.([blocked]);
    });

    expect(result.current.dashboards).toEqual([blocked]);

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores a mount refresh result that settles after unmount', async () => {
    const load = createDeferred<DynatraceDashboardState[]>();
    vi.mocked(api.listDynatraceDashboards).mockReturnValueOnce(load.promise);

    const { unmount } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => expect(listener).toBeTypeOf('function'));

    act(() => {
      listener?.([live]);
    });
    expect(showToast).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      load.resolve([auth]);
      await load.promise;
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it('opens dashboards through the bridge API', async () => {
    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    let opened = false;
    await act(async () => {
      opened = await result.current.openDashboard('dt_1');
    });

    expect(opened).toBe(true);
    expect(api.openDynatraceDashboard).toHaveBeenCalledWith('dt_1');
  });

  it('refreshes dashboards after successful add, update, and remove mutations', async () => {
    vi.mocked(api.listDynatraceDashboards)
      .mockResolvedValueOnce([live])
      .mockResolvedValueOnce([live, added])
      .mockResolvedValueOnce([updated, added])
      .mockResolvedValueOnce([updated]);

    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => expect(result.current.dashboards).toEqual([live]));

    let addedOk = false;
    await act(async () => {
      addedOk = await result.current.addDashboard(input);
    });
    expect(addedOk).toBe(true);
    expect(api.addDynatraceDashboard).toHaveBeenCalledWith(input);
    await waitFor(() => expect(result.current.dashboards).toEqual([live, added]));

    let updatedOk = false;
    await act(async () => {
      updatedOk = await result.current.updateDashboard('dt_1', input);
    });
    expect(updatedOk).toBe(true);
    expect(api.updateDynatraceDashboard).toHaveBeenCalledWith('dt_1', input);
    await waitFor(() => expect(result.current.dashboards).toEqual([updated, added]));

    let removedOk = false;
    await act(async () => {
      removedOk = await result.current.removeDashboard('dt_2');
    });
    expect(removedOk).toBe(true);
    expect(api.removeDynatraceDashboard).toHaveBeenCalledWith('dt_2');
    await waitFor(() => expect(result.current.dashboards).toEqual([updated]));

    expect(api.listDynatraceDashboards).toHaveBeenCalledTimes(4);
  });

  it('shows one warning when a dashboard transitions from live to authenticating', async () => {
    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => expect(listener).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.dashboards).toEqual([live]));

    act(() => {
      listener?.([live]);
    });
    act(() => {
      listener?.([auth]);
    });
    act(() => {
      listener?.([auth]);
    });
    act(() => {
      listener?.([live]);
    });
    act(() => {
      listener?.([auth]);
    });

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenNthCalledWith(1, 'Dynatrace dashboard signed out', 'warning');
    expect(showToast).toHaveBeenNthCalledWith(2, 'Dynatrace dashboard signed out', 'warning');
  });

  it('does not warn for non-live authenticating transitions', async () => {
    vi.mocked(api.listDynatraceDashboards).mockResolvedValueOnce([blocked]);

    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => expect(listener).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.dashboards).toEqual([blocked]));

    act(() => {
      listener?.([auth]);
    });

    expect(showToast).not.toHaveBeenCalledWith('Dynatrace dashboard signed out', 'warning');
  });

  it('shows error toasts for failed operations', async () => {
    vi.mocked(api.addDynatraceDashboard).mockResolvedValueOnce({
      success: false,
      error: 'Invalid Dynatrace URL',
    });
    vi.mocked(api.updateDynatraceDashboard).mockRejectedValueOnce(new Error('Update exploded'));
    vi.mocked(api.removeDynatraceDashboard).mockResolvedValueOnce({
      success: false,
      error: 'Missing dashboard',
    });
    vi.mocked(api.openDynatraceDashboard).mockResolvedValueOnce(false);
    vi.mocked(api.clearDynatraceSession).mockResolvedValueOnce({
      success: false,
      error: 'Session busy',
    });

    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    await act(async () => {
      expect(await result.current.addDashboard(input)).toBe(false);
      expect(await result.current.updateDashboard('dt_1', input)).toBe(false);
      expect(await result.current.removeDashboard('dt_1')).toBe(false);
      expect(await result.current.openDashboard('dt_1')).toBe(false);
      expect(await result.current.clearSession()).toBe(false);
    });

    expect(showToast).toHaveBeenCalledWith(
      'Failed to add Dynatrace dashboard: Invalid Dynatrace URL',
      'error',
    );
    expect(showToast).toHaveBeenCalledWith(
      'Failed to update Dynatrace dashboard: Update exploded',
      'error',
    );
    expect(showToast).toHaveBeenCalledWith(
      'Failed to remove Dynatrace dashboard: Missing dashboard',
      'error',
    );
    expect(showToast).toHaveBeenCalledWith('Failed to open Dynatrace dashboard', 'error');
    expect(showToast).toHaveBeenCalledWith(
      'Failed to clear Dynatrace session: Session busy',
      'error',
    );
  });

  it('sets an error and only toasts once while the bridge API is unavailable', async () => {
    removeApi();

    const { result } = renderHook(() => useDynatraceDashboards(showToast));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Dynatrace bridge API is unavailable.');
    });

    await act(async () => {
      expect(await result.current.addDashboard(input)).toBe(false);
      expect(await result.current.openDashboard('dt_1')).toBe(false);
      expect(await result.current.clearSession()).toBe(false);
      await result.current.refresh();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Dynatrace bridge API is unavailable.', 'error');
  });
});
