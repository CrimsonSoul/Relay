import { createHmac, randomBytes } from 'node:crypto';
import PocketBase, { BaseAuthStore } from 'pocketbase';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import { safePocketBaseAuthFailure, type SafePocketBaseAuthFailure } from '../app/pbErrors';

const AUTH_REUSE_WINDOW_MS = 4_000;
const AUTH_RATE_WINDOW_MS = 3_000;
const SHARED_AUTH_DEADLINE_MS = 15_000;
const MAX_COMPLETED_AUTHENTICATIONS = 16;
const MAX_IN_FLIGHT_AUTHENTICATIONS = 16;
const MAX_AUTH_ATTEMPT_WINDOWS = 32;

type AuthRecord = NonNullable<PocketBase['authStore']['record']>;
type AuthSnapshot = Readonly<{
  token: string;
  record: AuthRecord;
}>;
type CachedAuthentication = {
  expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout>;
  generation: number;
  identity: object;
  snapshot: AuthSnapshot;
};
type InFlightAuthentication = {
  controller: AbortController;
  generation: number;
  owner: PocketBase;
  promise: Promise<AuthSnapshot>;
  settled: boolean;
  waiters: number;
};
type AuthenticationAttemptWindow = {
  attemptedAt: number[];
  blockedUntil: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
  lastFailure?: SafePocketBaseAuthFailure;
};

export type RelayAppUserAuthOptions = Readonly<{
  forceRefresh?: boolean;
  signal?: AbortSignal;
}>;

export type RelayAppUserAuthOwnerFactory = (serverUrl: string) => PocketBase;

class RelayAppUserAuthCooldownError extends Error {
  readonly status?: number;

  constructor(failure?: SafePocketBaseAuthFailure) {
    super('Relay app-user authentication is cooling down');
    this.name = 'RelayAppUserAuthCooldownError';
    this.status = failure?.status;
  }
}

export function isRelayAppUserAuthCooldown(error: unknown): boolean {
  return error instanceof RelayAppUserAuthCooldownError;
}

function createProductionAuthOwner(serverUrl: string): PocketBase {
  return new PocketBase(serverUrl, new BaseAuthStore());
}

function isRelayAppUserRecord(record: PocketBase['authStore']['record']): record is AuthRecord {
  return (
    !!record &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    record.collectionId === '_pb_users_auth_' &&
    record.collectionName === 'users' &&
    record.email === RELAY_APP_USER_EMAIL
  );
}

function copyRelayAppUserRecord(record: AuthRecord): AuthRecord {
  return {
    id: record.id,
    email: RELAY_APP_USER_EMAIL,
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
  };
}

function readAuthenticatedSnapshot(client: PocketBase, errorMessage: string): AuthSnapshot {
  const token = client.authStore.token;
  const record = client.authStore.record;
  if (!token || !isRelayAppUserRecord(record) || !client.authStore.isValid) {
    throw new Error(errorMessage);
  }
  return { token, record: copyRelayAppUserRecord(record) };
}

function installSnapshot(client: PocketBase, snapshot: AuthSnapshot): void {
  client.authStore.save(snapshot.token, copyRelayAppUserRecord(snapshot.record));
  if (
    !client.authStore.isValid ||
    client.authStore.token !== snapshot.token ||
    client.authStore.record?.id !== snapshot.record.id ||
    !isRelayAppUserRecord(client.authStore.record)
  ) {
    client.authStore.clear();
    throw new Error('PocketBase did not accept the shared Relay app-user session');
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function awaitWithSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortError(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export class RelayAppUserAuthCoordinator {
  private readonly authenticationAttemptWindows = new Map<string, AuthenticationAttemptWindow>();
  private readonly completedAuthentications = new Map<string, CachedAuthentication>();
  private readonly credentialKeySalt = randomBytes(32);
  private readonly inFlightAuthentications = new Map<string, InFlightAuthentication>();
  private coordinatorGeneration = 0;

  constructor(
    private readonly createAuthOwner: RelayAppUserAuthOwnerFactory = createProductionAuthOwner,
  ) {}

  private credentialKey(serverUrl: string, secret: string): string {
    return createHmac('sha256', this.credentialKeySalt)
      .update(String(Buffer.byteLength(serverUrl, 'utf8')))
      .update(':')
      .update(serverUrl, 'utf8')
      .update(':')
      .update(String(Buffer.byteLength(secret, 'utf8')))
      .update(':')
      .update(secret, 'utf8')
      .digest('base64url');
  }

  private deleteAuthenticationAttemptWindow(
    key: string,
    expected?: AuthenticationAttemptWindow,
  ): void {
    const window = this.authenticationAttemptWindows.get(key);
    if (!window || (expected && window !== expected)) return;
    if (window.expiryTimer) clearTimeout(window.expiryTimer);
    this.authenticationAttemptWindows.delete(key);
  }

  private pruneAuthenticationAttemptWindow(
    key: string,
    window: AuthenticationAttemptWindow,
    now: number,
  ): void {
    window.attemptedAt = window.attemptedAt.filter(
      (attemptedAt) => now - attemptedAt < AUTH_RATE_WINDOW_MS,
    );
    if (window.blockedUntil <= now) window.blockedUntil = 0;
    if (window.attemptedAt.length === 0 && window.blockedUntil === 0) {
      this.deleteAuthenticationAttemptWindow(key, window);
      return;
    }
    this.scheduleAuthenticationAttemptWindowExpiry(key, window, now);
  }

  private scheduleAuthenticationAttemptWindowExpiry(
    key: string,
    window: AuthenticationAttemptWindow,
    now = Date.now(),
  ): void {
    if (window.expiryTimer) clearTimeout(window.expiryTimer);
    const expiryCandidates = [
      window.attemptedAt[0] === undefined
        ? Number.POSITIVE_INFINITY
        : window.attemptedAt[0] + AUTH_RATE_WINDOW_MS,
      window.blockedUntil > now ? window.blockedUntil : Number.POSITIVE_INFINITY,
    ];
    const expiresAt = Math.min(...expiryCandidates);
    if (!Number.isFinite(expiresAt)) {
      this.deleteAuthenticationAttemptWindow(key, window);
      return;
    }
    window.expiryTimer = setTimeout(
      () => {
        const current = this.authenticationAttemptWindows.get(key);
        if (current !== window || current.generation !== this.coordinatorGeneration) return;
        this.pruneAuthenticationAttemptWindow(key, current, Date.now());
      },
      Math.max(0, expiresAt - now),
    );
    window.expiryTimer.unref?.();
  }

  private pruneAuthenticationAttemptWindows(now: number): void {
    for (const [key, window] of this.authenticationAttemptWindows) {
      this.pruneAuthenticationAttemptWindow(key, window, now);
    }
  }

  private getOrCreateAuthenticationAttemptWindow(
    key: string,
    now: number,
  ): AuthenticationAttemptWindow {
    this.pruneAuthenticationAttemptWindows(now);
    const existing = this.authenticationAttemptWindows.get(key);
    if (existing) return existing;
    if (this.authenticationAttemptWindows.size >= MAX_AUTH_ATTEMPT_WINDOWS) {
      throw new Error('Relay app-user authentication capacity is temporarily unavailable');
    }
    const window: AuthenticationAttemptWindow = {
      attemptedAt: [],
      blockedUntil: 0,
      expiryTimer: null,
      generation: this.coordinatorGeneration,
    };
    this.authenticationAttemptWindows.set(key, window);
    return window;
  }

  private reserveAuthenticationAttempt(key: string): void {
    const now = Date.now();
    const window = this.getOrCreateAuthenticationAttemptWindow(key, now);
    if (window.blockedUntil > now || window.attemptedAt.length >= 2) {
      throw new RelayAppUserAuthCooldownError(window.lastFailure);
    }
    window.attemptedAt.push(now);
    this.scheduleAuthenticationAttemptWindowExpiry(key, window, now);
  }

  private noteAuthenticationFailure(key: string, error: unknown): void {
    const window = this.authenticationAttemptWindows.get(key);
    if (window?.generation !== this.coordinatorGeneration) return;
    const failure = safePocketBaseAuthFailure(error);
    window.lastFailure = failure;
    if (failure.category === 'credential-rejected' || failure.category === 'rate-limited') {
      window.blockedUntil = Math.max(
        window.blockedUntil,
        (window.attemptedAt.at(-1) ?? Date.now()) + AUTH_RATE_WINDOW_MS,
      );
    }
    this.scheduleAuthenticationAttemptWindowExpiry(key, window);
  }

  private noteAuthenticationSuccess(key: string): void {
    const window = this.authenticationAttemptWindows.get(key);
    if (window?.generation !== this.coordinatorGeneration) return;
    window.blockedUntil = 0;
    window.lastFailure = undefined;
    this.scheduleAuthenticationAttemptWindowExpiry(key, window);
  }

  private notePrimedAuthentication(key: string): void {
    const now = Date.now();
    const window = this.getOrCreateAuthenticationAttemptWindow(key, now);
    window.attemptedAt = [now, now];
    window.blockedUntil = 0;
    window.lastFailure = undefined;
    this.scheduleAuthenticationAttemptWindowExpiry(key, window, now);
  }

  private deleteCachedAuthentication(key: string, expected?: CachedAuthentication): void {
    const cached = this.completedAuthentications.get(key);
    if (!cached || (expected && cached !== expected)) return;
    clearTimeout(cached.expiryTimer);
    this.completedAuthentications.delete(key);
  }

  private pruneExpiredAuthentications(now: number): void {
    for (const [key, authentication] of this.completedAuthentications) {
      if (authentication.expiresAt <= now) {
        this.deleteCachedAuthentication(key, authentication);
      }
    }
  }

  private cacheAuthentication(key: string, snapshot: AuthSnapshot): void {
    const now = Date.now();
    this.pruneExpiredAuthentications(now);
    this.deleteCachedAuthentication(key);
    while (this.completedAuthentications.size >= MAX_COMPLETED_AUTHENTICATIONS) {
      const oldestKey = this.completedAuthentications.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      this.deleteCachedAuthentication(oldestKey);
    }
    const generation = this.coordinatorGeneration;
    const identity = {};
    const expiryTimer = setTimeout(() => {
      const current = this.completedAuthentications.get(key);
      if (current?.identity !== identity || current.generation !== this.coordinatorGeneration) {
        return;
      }
      this.deleteCachedAuthentication(key, current);
    }, AUTH_REUSE_WINDOW_MS);
    expiryTimer.unref?.();
    this.completedAuthentications.set(key, {
      expiresAt: now + AUTH_REUSE_WINDOW_MS,
      expiryTimer,
      generation,
      identity,
      snapshot: {
        token: snapshot.token,
        record: copyRelayAppUserRecord(snapshot.record),
      },
    });
  }

  private getCachedAuthentication(key: string): AuthSnapshot | null {
    const now = Date.now();
    this.pruneExpiredAuthentications(now);
    const cached = this.completedAuthentications.get(key);
    if (!cached) return null;

    // Preserve the original expiry while making eviction least-recently-used.
    this.completedAuthentications.delete(key);
    this.completedAuthentications.set(key, cached);
    return {
      token: cached.snapshot.token,
      record: copyRelayAppUserRecord(cached.snapshot.record),
    };
  }

  private createAuthentication(
    key: string,
    serverUrl: string,
    secret: string,
  ): InFlightAuthentication {
    if (this.inFlightAuthentications.size >= MAX_IN_FLIGHT_AUTHENTICATIONS) {
      throw new Error('Relay app-user authentication capacity is temporarily unavailable');
    }
    this.reserveAuthenticationAttempt(key);

    const controller = new AbortController();
    const generation = this.coordinatorGeneration;
    const owner = this.createAuthOwner(serverUrl);
    let entry: InFlightAuthentication;
    const promise = Promise.resolve().then(async () => {
      const deadline = setTimeout(() => {
        controller.abort(
          new DOMException('Relay app-user authentication timed out.', 'AbortError'),
        );
      }, SHARED_AUTH_DEADLINE_MS);
      deadline.unref?.();
      try {
        const authentication = owner
          .collection('_pb_users_auth_')
          .authWithPassword(RELAY_APP_USER_EMAIL, secret, {
            requestKey: null,
            signal: controller.signal,
          });
        void authentication.then(
          () => {
            if (controller.signal.aborted || generation !== this.coordinatorGeneration) {
              owner.authStore.clear();
            }
          },
          () => owner.authStore.clear(),
        );
        await awaitWithSignal(authentication, controller.signal);
        const snapshot = readAuthenticatedSnapshot(
          owner,
          'PocketBase did not accept Relay app-user authentication',
        );
        this.noteAuthenticationSuccess(key);
        if (
          generation === this.coordinatorGeneration &&
          this.inFlightAuthentications.get(key) === entry
        ) {
          this.cacheAuthentication(key, snapshot);
        }
        return snapshot;
      } catch (error) {
        this.noteAuthenticationFailure(key, error);
        throw error;
      } finally {
        clearTimeout(deadline);
        owner.authStore.clear();
        entry.settled = true;
        if (this.inFlightAuthentications.get(key) === entry) {
          this.inFlightAuthentications.delete(key);
        }
      }
    });
    entry = {
      controller,
      generation,
      owner,
      promise,
      settled: false,
      waiters: 0,
    };
    // A caller may abort just before the shared request settles. Keep that
    // bounded request from becoming an unhandled rejection after its last waiter leaves.
    void promise.catch(() => undefined);
    this.inFlightAuthentications.set(key, entry);
    return entry;
  }

  private async waitForAuthentication(
    entry: InFlightAuthentication,
    signal?: AbortSignal,
  ): Promise<AuthSnapshot> {
    if (signal?.aborted) throw abortError(signal);
    entry.waiters += 1;
    try {
      return await awaitWithSignal(entry.promise, signal);
    } finally {
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) {
        entry.controller.abort(new DOMException('The operation was aborted.', 'AbortError'));
      }
    }
  }

  async authenticate(
    client: PocketBase,
    serverUrl: string,
    secret: string,
    options: RelayAppUserAuthOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted) throw abortError(options.signal);
    const key = this.credentialKey(serverUrl, secret);
    if (options.forceRefresh) {
      this.deleteCachedAuthentication(key);
    } else {
      const cached = this.getCachedAuthentication(key);
      if (cached) {
        try {
          installSnapshot(client, cached);
          return;
        } catch (error) {
          this.deleteCachedAuthentication(key);
          throw error;
        }
      }
    }

    const entry =
      this.inFlightAuthentications.get(key) ?? this.createAuthentication(key, serverUrl, secret);
    const generation = this.coordinatorGeneration;
    const snapshot = await this.waitForAuthentication(entry, options.signal);
    if (
      options.signal?.aborted ||
      generation !== this.coordinatorGeneration ||
      entry.generation !== this.coordinatorGeneration
    ) {
      throw (
        options.signal?.reason ??
        entry.controller.signal.reason ??
        new DOMException('Relay runtime authentication was reset.', 'AbortError')
      );
    }
    installSnapshot(client, snapshot);
  }

  prime(client: PocketBase, serverUrl: string, secret: string): void {
    const snapshot = readAuthenticatedSnapshot(
      client,
      'PocketBase did not retain the authenticated Relay app-user session',
    );
    const key = this.credentialKey(serverUrl, secret);
    this.notePrimedAuthentication(key);
    this.cacheAuthentication(key, snapshot);
  }

  clear(): void {
    this.coordinatorGeneration += 1;
    for (const key of this.authenticationAttemptWindows.keys()) {
      this.deleteAuthenticationAttemptWindow(key);
    }
    for (const key of this.completedAuthentications.keys()) {
      this.deleteCachedAuthentication(key);
    }
    for (const entry of this.inFlightAuthentications.values()) {
      entry.owner.authStore.clear();
      entry.controller.abort(
        new DOMException('Relay runtime authentication was reset.', 'AbortError'),
      );
    }
    this.inFlightAuthentications.clear();
  }
}

const sharedRelayAppUserAuthCoordinator = new RelayAppUserAuthCoordinator();

export function authenticateRelayAppUserShared(
  client: PocketBase,
  serverUrl: string,
  secret: string,
  options: RelayAppUserAuthOptions = {},
): Promise<void> {
  return sharedRelayAppUserAuthCoordinator.authenticate(client, serverUrl, secret, options);
}

export function primeRelayAppUserAuth(client: PocketBase, serverUrl: string, secret: string): void {
  sharedRelayAppUserAuthCoordinator.prime(client, serverUrl, secret);
}

export function clearRelayAppUserAuthCoordinator(): void {
  sharedRelayAppUserAuthCoordinator.clear();
}
