import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DynatraceDashboardInput,
  DynatraceDashboardState,
  DynatraceRuntimeState,
} from '@shared/dynatrace';
import type { BridgeAPI, IpcResult } from '@shared/ipc';

type DynatraceToastType = 'success' | 'error' | 'info' | 'warning';
type ShowDynatraceToast = (message: string, type: DynatraceToastType) => void;

type DynatraceBridgeApi = Pick<
  BridgeAPI,
  | 'listDynatraceDashboards'
  | 'addDynatraceDashboard'
  | 'updateDynatraceDashboard'
  | 'removeDynatraceDashboard'
  | 'openDynatraceDashboard'
  | 'clearDynatraceSession'
  | 'onDynatraceDashboardsChanged'
>;

const BRIDGE_UNAVAILABLE = 'Dynatrace bridge API is unavailable.';
const AUTH_WARNING = 'Dynatrace dashboard signed out';
const RESET_AUTH_WARNING_STATES = new Set<DynatraceRuntimeState>([
  'live',
  'closed',
  'blocked',
  'load-failed',
]);

function getDynatraceApi(): DynatraceBridgeApi | null {
  const api = globalThis.window?.api ?? globalThis.api;

  if (
    !api?.listDynatraceDashboards ||
    !api.addDynatraceDashboard ||
    !api.updateDynatraceDashboard ||
    !api.removeDynatraceDashboard ||
    !api.openDynatraceDashboard ||
    !api.clearDynatraceSession ||
    !api.onDynatraceDashboardsChanged
  ) {
    return null;
  }

  return api;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function failureMessage(action: string, error?: string): string {
  return error ? `Failed to ${action}: ${error}` : `Failed to ${action}`;
}

function isSuccessful(result: IpcResult): boolean {
  return result.success === true;
}

export function useDynatraceDashboards(showToast: ShowDynatraceToast): {
  dashboards: DynatraceDashboardState[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addDashboard: (input: DynatraceDashboardInput) => Promise<boolean>;
  updateDashboard: (id: string, input: DynatraceDashboardInput) => Promise<boolean>;
  removeDashboard: (id: string) => Promise<boolean>;
  openDashboard: (id: string) => Promise<boolean>;
  clearSession: () => Promise<boolean>;
} {
  const [dashboards, setDashboards] = useState<DynatraceDashboardState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showToastRef = useRef(showToast);
  const previousStateByIdRef = useRef(new Map<string, DynatraceRuntimeState>());
  const authenticatingWarningByIdRef = useRef(new Set<string>());

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const toastError = useCallback((message: string) => {
    showToastRef.current(message, 'error');
  }, []);

  const applyDashboards = useCallback((nextDashboards: DynatraceDashboardState[]) => {
    const previousStateById = previousStateByIdRef.current;
    const warnedIds = authenticatingWarningByIdRef.current;
    const nextStateById = new Map<string, DynatraceRuntimeState>();

    for (const dashboard of nextDashboards) {
      const previousState = previousStateById.get(dashboard.id);
      nextStateById.set(dashboard.id, dashboard.state);

      if (RESET_AUTH_WARNING_STATES.has(dashboard.state)) {
        warnedIds.delete(dashboard.id);
      }

      if (
        previousState === 'live' &&
        dashboard.state === 'authenticating' &&
        !warnedIds.has(dashboard.id)
      ) {
        showToastRef.current(AUTH_WARNING, 'warning');
        warnedIds.add(dashboard.id);
      }
    }

    for (const id of Array.from(warnedIds)) {
      if (!nextStateById.has(id)) {
        warnedIds.delete(id);
      }
    }

    previousStateByIdRef.current = nextStateById;
    setDashboards(nextDashboards);
  }, []);

  const handleMissingApi = useCallback(() => {
    setError(BRIDGE_UNAVAILABLE);
    setLoading(false);
    toastError(BRIDGE_UNAVAILABLE);
  }, [toastError]);

  const refresh = useCallback(async () => {
    const api = getDynatraceApi();
    if (!api) {
      handleMissingApi();
      return;
    }

    setLoading(true);
    try {
      const nextDashboards = await api.listDynatraceDashboards();
      applyDashboards(nextDashboards);
      setError(null);
    } catch (err) {
      const message = failureMessage('load Dynatrace dashboards', getErrorMessage(err));
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [applyDashboards, handleMissingApi, toastError]);

  const withApi = useCallback((): DynatraceBridgeApi | null => {
    const api = getDynatraceApi();
    if (!api) {
      handleMissingApi();
      return null;
    }

    setError(null);
    return api;
  }, [handleMissingApi]);

  const runMutation = useCallback(
    async (
      action: string,
      operation: (api: DynatraceBridgeApi) => Promise<IpcResult>,
    ): Promise<boolean> => {
      const api = withApi();
      if (!api) return false;

      try {
        const result = await operation(api);
        if (!isSuccessful(result)) {
          const message = failureMessage(action, result.error);
          setError(message);
          toastError(message);
          return false;
        }

        await refresh();
        return true;
      } catch (err) {
        const message = failureMessage(action, getErrorMessage(err));
        setError(message);
        toastError(message);
        return false;
      }
    },
    [refresh, toastError, withApi],
  );

  const addDashboard = useCallback(
    (input: DynatraceDashboardInput) =>
      runMutation('add Dynatrace dashboard', (api) => api.addDynatraceDashboard(input)),
    [runMutation],
  );

  const updateDashboard = useCallback(
    (id: string, input: DynatraceDashboardInput) =>
      runMutation('update Dynatrace dashboard', (api) => api.updateDynatraceDashboard(id, input)),
    [runMutation],
  );

  const removeDashboard = useCallback(
    (id: string) =>
      runMutation('remove Dynatrace dashboard', (api) => api.removeDynatraceDashboard(id)),
    [runMutation],
  );

  const openDashboard = useCallback(
    async (id: string): Promise<boolean> => {
      const api = withApi();
      if (!api) return false;

      try {
        const opened = await api.openDynatraceDashboard(id);
        if (!opened) {
          const message = failureMessage('open Dynatrace dashboard');
          setError(message);
          toastError(message);
          return false;
        }
        return true;
      } catch (err) {
        const message = failureMessage('open Dynatrace dashboard', getErrorMessage(err));
        setError(message);
        toastError(message);
        return false;
      }
    },
    [toastError, withApi],
  );

  const clearSession = useCallback(async (): Promise<boolean> => {
    const api = withApi();
    if (!api) return false;

    try {
      const result = await api.clearDynatraceSession();
      if (!isSuccessful(result)) {
        const message = failureMessage('clear Dynatrace session', result.error);
        setError(message);
        toastError(message);
        return false;
      }
      return true;
    } catch (err) {
      const message = failureMessage('clear Dynatrace session', getErrorMessage(err));
      setError(message);
      toastError(message);
      return false;
    }
  }, [toastError, withApi]);

  useEffect(() => {
    const api = getDynatraceApi();
    if (!api) {
      handleMissingApi();
      return;
    }

    void refresh();
    return api.onDynatraceDashboardsChanged((nextDashboards) => {
      applyDashboards(nextDashboards);
      setError(null);
    });
  }, [applyDashboards, handleMissingApi, refresh]);

  return {
    dashboards,
    loading,
    error,
    refresh,
    addDashboard,
    updateDashboard,
    removeDashboard,
    openDashboard,
    clearSession,
  };
}
