import PocketBase from 'pocketbase';
import type { PbAuthSession, PbConnectionResult } from '@shared/ipc';
import { loggers } from '../utils/logger';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'reconnecting' | 'auth-failed';

type StateListener = (state: ConnectionState) => void;
type ClientListener = (generation: number) => void;

let pb: PocketBase | null = null;
let connectionState: ConnectionState = 'connecting';
let clientGeneration = 0;
let healthCheckInFlight = false;
let healthCheckAbortController: AbortController | null = null;
let healthCheckTimeout: ReturnType<typeof setTimeout> | null = null;
const stateListeners = new Set<StateListener>();
const clientListeners = new Set<ClientListener>();
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const HEALTH_INTERVAL_ONLINE_MS = 30_000;
const HEALTH_INTERVAL_DEGRADED_MS = 5_000;

let healthLoopTimer: ReturnType<typeof setTimeout> | null = null;
let healthLoopActive = false;
let networkListenersInstalled = false;

export function initPocketBase(url: string): PocketBase {
  const previousUrl = pb?.baseURL ?? null;
  pb = new PocketBase(url);
  setConnectionState('connecting');
  if (previousUrl !== null && previousUrl !== url) {
    clientGeneration++;
    clientListeners.forEach((fn) => fn(clientGeneration));
  }
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

export function getPocketBaseClientGeneration(): number {
  return clientGeneration;
}

export function onPocketBaseClientChange(listener: ClientListener): () => void {
  clientListeners.add(listener);
  return () => clientListeners.delete(listener);
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

export type RefreshResult = 'ok' | 'auth-failed' | 'unavailable';

export async function refreshAuthSession(skipHealthRestart = false): Promise<RefreshResult> {
  try {
    const result: PbConnectionResult | null | undefined =
      await globalThis.api?.refreshPbConnection?.();
    if (!result?.ok) {
      loggers.network.warn('PB connection refresh rejected', {
        error: result && 'error' in result ? result.error : 'no-result',
      });
      return result && 'error' in result && result.error === 'auth-failed'
        ? 'auth-failed'
        : 'unavailable';
    }
    if (result.connection.pbUrl !== getPb().baseURL) {
      initPocketBase(result.connection.pbUrl);
    }
    loadAuthSession(result.connection.auth, skipHealthRestart);
    return 'ok';
  } catch (error) {
    loggers.network.warn('Session refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unavailable';
  }
}

function applyRefreshFailure(result: RefreshResult): void {
  setConnectionState(result === 'auth-failed' ? 'auth-failed' : 'offline');
}

function beginHealthCheckProbe(): AbortController | null {
  if (healthCheckInFlight) return null;

  healthCheckInFlight = true;
  const controller = new AbortController();
  healthCheckAbortController = controller;
  healthCheckTimeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  return controller;
}

function finishHealthCheckProbe(controller: AbortController): void {
  if (healthCheckAbortController !== controller) return;

  if (healthCheckTimeout) clearTimeout(healthCheckTimeout);
  healthCheckTimeout = null;
  healthCheckAbortController = null;
  healthCheckInFlight = false;
}

async function handleHealthyProbe(): Promise<void> {
  if (connectionState === 'online') {
    if (getPb().authStore.isValid) return;

    setConnectionState('reconnecting');
    const refreshed = await refreshAuthSession(true);
    if (refreshed !== 'ok') {
      loggers.network.warn('Auth session refresh failed while online');
      applyRefreshFailure(refreshed);
    }
    return;
  }

  // Rehydrate auth if the token expired during offline time.
  // Do NOT emit 'reconnecting' — subscribers listen for state changes
  // and would resubscribe before auth is complete.
  // A locally-unexpired token can't be trusted out of auth-failed — the server
  // already rejected it. Recovery must go through a successful refresh.
  if (connectionState !== 'auth-failed' && getPb().authStore.isValid) {
    setConnectionState('online');
    return;
  }

  const refreshed = await refreshAuthSession(true);
  if (refreshed !== 'ok') {
    loggers.network.warn('Auth session refresh failed on reconnect');
    applyRefreshFailure(refreshed);
  }
}

function handleFailedProbe(): void {
  if (connectionState === 'online' || connectionState === 'auth-failed') {
    setConnectionState('offline');
  }
}

async function runHealthCheckProbe(): Promise<void> {
  const controller = beginHealthCheckProbe();
  if (!controller) return;

  try {
    const res = await fetch(`${getPb().baseURL}/api/health`, { signal: controller.signal });
    if (res.ok) {
      await handleHealthyProbe();
    } else {
      handleFailedProbe();
    }
  } catch {
    handleFailedProbe();
  } finally {
    finishHealthCheckProbe(controller);
  }
}

function scheduleNextProbe(): void {
  if (!healthLoopActive) return;
  if (healthLoopTimer) clearTimeout(healthLoopTimer);
  // auth-failed uses the relaxed cadence too — a hot retry loop would hammer
  // the server's rate-limited auth endpoint without helping the user.
  const interval =
    connectionState === 'online' || connectionState === 'auth-failed'
      ? HEALTH_INTERVAL_ONLINE_MS
      : HEALTH_INTERVAL_DEGRADED_MS;
  healthLoopTimer = setTimeout(() => void runProbeAndReschedule(), interval);
}

async function runProbeAndReschedule(): Promise<void> {
  await runHealthCheckProbe();
  scheduleNextProbe();
}

function handleNetworkEvent(): void {
  if (!healthLoopActive) return;
  // Reset the pending timer and probe now — cadence resumes from this probe.
  if (healthLoopTimer) clearTimeout(healthLoopTimer);
  void runProbeAndReschedule();
}

export function startHealthCheck(): void {
  stopHealthCheck();
  healthLoopActive = true;
  if (!networkListenersInstalled) {
    globalThis.window.addEventListener('online', handleNetworkEvent);
    globalThis.window.addEventListener('offline', handleNetworkEvent);
    networkListenersInstalled = true;
  }
  void runProbeAndReschedule();
}

export function stopHealthCheck(): void {
  healthLoopActive = false;
  if (healthLoopTimer) {
    clearTimeout(healthLoopTimer);
    healthLoopTimer = null;
  }
  if (networkListenersInstalled) {
    globalThis.window.removeEventListener('online', handleNetworkEvent);
    globalThis.window.removeEventListener('offline', handleNetworkEvent);
    networkListenersInstalled = false;
  }
  if (healthCheckTimeout) clearTimeout(healthCheckTimeout);
  healthCheckTimeout = null;
  healthCheckAbortController?.abort();
  healthCheckAbortController = null;
  healthCheckInFlight = false;
}

export function handleApiError(error: unknown): void {
  if (error instanceof TypeError && error.message.includes('fetch')) {
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
    return;
  }
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    ((error as { status: number }).status === 401 || (error as { status: number }).status === 403)
  ) {
    setConnectionState('reconnecting');
    void refreshAuthSession().then((refreshed) => {
      if (refreshed !== 'ok') applyRefreshFailure(refreshed);
    });
  }
}

export { isPbNotFoundError } from './pbErrors';

export function isOnline(): boolean {
  return connectionState === 'online';
}

/** Throws immediately if offline — prevents writes from silently failing with a network error. */
export function requireOnline(): void {
  if (!isOnline()) {
    throw new Error(
      connectionState === 'auth-failed'
        ? 'Sign-in to the Relay server failed. Update the passphrase before saving changes.'
        : 'You are offline. Changes cannot be saved until the connection is restored.',
    );
  }
}

/** Escape a value for use in PocketBase filter strings to prevent injection. */
export function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
