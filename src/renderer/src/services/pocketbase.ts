import PocketBase from 'pocketbase';
import type { PbAuthSession, PbConnectionResult } from '@shared/ipc';
import { loggers } from '../utils/logger';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'reconnecting';

type StateListener = (state: ConnectionState) => void;

let pb: PocketBase | null = null;
let connectionState: ConnectionState = 'connecting';
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
const stateListeners = new Set<StateListener>();

export function initPocketBase(url: string): PocketBase {
  pb = new PocketBase(url);
  connectionState = 'connecting';
  return pb;
}

export function getPb(): PocketBase {
  if (!pb) throw new Error('PocketBase not initialized. Call initPocketBase() first.');
  return pb;
}

export function getConnectionState(): ConnectionState {
  return connectionState;
}

export function onConnectionStateChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function setConnectionState(state: ConnectionState): void {
  if (connectionState === state) return;
  connectionState = state;
  stateListeners.forEach((fn) => fn(state));
}

export function loadAuthSession(auth: PbAuthSession, skipHealthRestart = false): void {
  const pb = getPb();
  pb.authStore.save(auth.token, auth.record);
  setConnectionState('online');
  if (!skipHealthRestart) startHealthCheck();
}

export async function refreshAuthSession(skipHealthRestart = false): Promise<boolean> {
  try {
    const result: PbConnectionResult | null | undefined =
      await globalThis.api?.refreshPbConnection?.();
    if (!result?.ok) return false;
    if (result.connection.pbUrl !== getPb().baseURL) {
      initPocketBase(result.connection.pbUrl);
    }
    loadAuthSession(result.connection.auth, skipHealthRestart);
    return true;
  } catch (error) {
    loggers.network.warn('Session refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function startHealthCheck(intervalMs = 30000): void {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`${getPb().baseURL}/api/health`);
      if (res.ok && connectionState !== 'online') {
        // Rehydrate auth if the token expired during offline time.
        // Do NOT emit 'reconnecting' — subscribers listen for state changes
        // and would resubscribe before auth is complete.
        if (!getPb().authStore.isValid) {
          const refreshed = await refreshAuthSession(true);
          if (!refreshed) {
            loggers.network.warn('Auth session refresh failed on reconnect');
            return;
          }
        } else {
          setConnectionState('online');
        }
      } else if (!res.ok && connectionState === 'online') {
        setConnectionState('offline');
      }
    } catch {
      if (connectionState === 'online') {
        setConnectionState('offline');
      }
    }
  }, intervalMs);
}

export function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

export function handleApiError(error: unknown): void {
  if (error instanceof TypeError && (error as TypeError).message.includes('fetch')) {
    setConnectionState('offline');
    return;
  }
  // PocketBase SDK wraps network errors as ClientResponseError with status 0.
  // Auto-cancelled requests (isAbort) also have status 0 but are NOT network
  // failures — skip those so we don't falsely flip the connection to offline.
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: number }).status === 0 &&
    !('isAbort' in error && (error as { isAbort: boolean }).isAbort)
  ) {
    setConnectionState('offline');
  }
}

export { isPbNotFoundError } from './pbErrors';

export function isOnline(): boolean {
  return connectionState === 'online';
}

/** Throws immediately if offline — prevents writes from silently failing with a network error. */
export function requireOnline(): void {
  if (!isOnline()) {
    throw new Error('You are offline. Changes cannot be saved until the connection is restored.');
  }
}

/** Escape a value for use in PocketBase filter strings to prevent injection. */
export function escapeFilter(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
