import PocketBase from 'pocketbase';

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

export async function authenticate(secret: string): Promise<boolean> {
  const pb = getPb();
  setStoredSecret(secret);

  // Try app user first — this works both locally and remotely.
  // Superuser auth is restricted to localhost by PocketBase, so it would
  // fail for remote clients. Only fall back to superuser for local dev/setup.
  try {
    await pb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', secret);
    setConnectionState('online');
    startHealthCheck();
    return true;
  } catch (appErr) {
    console.warn('App user auth failed, trying superuser fallback', appErr);
  }

  // Fall back to superuser (localhost only — useful during initial setup
  // before the app user has been created)
  try {
    await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);
    setConnectionState('online');
    startHealthCheck();
    return true;
  } catch (suErr) {
    console.error('All auth methods failed', suErr);
    return false;
  }
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
        setConnectionState('reconnecting');
        // Re-authenticate if token expired during offline period
        if (!getPb().authStore.isValid && storedSecret) {
          const reauthed = await authenticate(storedSecret);
          if (!reauthed) {
            console.warn('Re-authentication failed on reconnect');
            return;
          }
        } else if (!getPb().authStore.isValid) {
          return;
        }
        setConnectionState('online');
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
  // PocketBase SDK wraps network errors as ClientResponseError with status 0
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: number }).status === 0
  ) {
    setConnectionState('offline');
  }
}

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
