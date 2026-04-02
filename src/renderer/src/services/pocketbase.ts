import PocketBase from 'pocketbase';
import { loggers } from '../utils/logger';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'reconnecting';

/** Per-attempt timeout for authWithPassword calls. */
export const AUTH_TIMEOUT_MS = 15_000;

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

export async function authenticate(secret: string, skipHealthRestart = false): Promise<boolean> {
  const pb = getPb();
  setStoredSecret(secret);

  // Try app user first — this works both locally and remotely.
  // Superuser auth is restricted to localhost by PocketBase, so it would
  // fail for remote clients. Only fall back to superuser for local dev/setup.
  try {
    await authWithTimeout(pb, '_pb_users_auth_', 'relay@relay.app', secret);
    setConnectionState('online');
    if (!skipHealthRestart) startHealthCheck();
    return true;
  } catch (appErr) {
    loggers.network.warn('App user auth failed, trying superuser fallback', {
      error: appErr instanceof Error ? appErr.message : String(appErr),
    });
  }

  // Fall back to superuser (localhost only — useful during initial setup
  // before the app user has been created)
  try {
    await authWithTimeout(pb, '_superusers', 'admin@relay.app', secret);
    setConnectionState('online');
    if (!skipHealthRestart) startHealthCheck();
    return true;
  } catch (suErr) {
    loggers.network.error('All auth methods failed', {
      error: suErr instanceof Error ? suErr.message : String(suErr),
    });
    return false;
  }
}

/** Wraps authWithPassword with an AbortController timeout so a hung server can't block forever. */
function authWithTimeout(
  pb: PocketBase,
  collection: string,
  email: string,
  password: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  // requestKey: null prevents the PB SDK from replacing our signal with its
  // own internal AbortController (which would make our timeout ineffective).
  return pb
    .collection(collection)
    .authWithPassword(email, password, { signal: controller.signal, requestKey: null })
    .finally(() => clearTimeout(timer));
}

/** Stored secret for re-authentication on reconnect. Cleared after 8 hours. */
let storedSecret: string | null = null;
let storedSecretTimer: ReturnType<typeof setTimeout> | null = null;
const SECRET_TTL_MS = 8 * 60 * 60 * 1000;

export function setStoredSecret(secret: string): void {
  storedSecret = secret;
  if (storedSecretTimer) clearTimeout(storedSecretTimer);
  storedSecretTimer = setTimeout(() => {
    storedSecret = null;
    storedSecretTimer = null;
  }, SECRET_TTL_MS);
}

export function startHealthCheck(intervalMs = 30000): void {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`${getPb().baseURL}/api/health`);
      if (res.ok && connectionState !== 'online') {
        // Re-authenticate if token expired during offline period.
        // Do NOT emit 'reconnecting' — subscribers listen for state changes
        // and would resubscribe before auth is complete.
        if (!getPb().authStore.isValid && storedSecret) {
          const reauthed = await authenticate(storedSecret, true);
          if (!reauthed) {
            loggers.network.warn('Re-authentication failed on reconnect');
            return;
          }
          // authenticate already sets state to 'online' on success
        } else if (!getPb().authStore.isValid) {
          return;
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
