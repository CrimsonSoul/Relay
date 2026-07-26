import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import type { PbAuthSession, PublicRelayConfig } from '@shared/ipc';
import type { RelayRuntimeDescriptor } from '@shared/runtime';

export const WEB_SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1_000;
export const WEB_SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1_000;

export type WebSessionCreateInput = {
  pbUrl: string;
  auth: PbAuthSession;
  publicConfig: Extract<PublicRelayConfig, { mode: 'server' }>;
  runtime: RelayRuntimeDescriptor;
  presenceLabel?: string;
  refresh: () => Promise<PbAuthSession>;
  dispose?: () => void | Promise<void>;
};

export type WebSessionRecord = {
  id: string;
  csrfToken: string;
  rateLimitId: string;
  pbUrl: string;
  auth: PbAuthSession;
  publicConfig: Extract<PublicRelayConfig, { mode: 'server' }>;
  runtime: RelayRuntimeDescriptor;
  presenceLabel: string;
  createdAt: number;
  lastActiveAt: number;
};

type WebSessionEntry = WebSessionRecord & {
  refreshAuth: WebSessionCreateInput['refresh'];
  disposeAuth?: NonNullable<WebSessionCreateInput['dispose']>;
  cleanups: Set<() => void | Promise<void>>;
  eventSinks: Set<(event: string, data: unknown) => void>;
  generation: number;
  revoked: boolean;
  refreshPromise?: Promise<WebSessionRecord | null>;
  disposePromise?: Promise<void>;
  destroyNotified: boolean;
};

type WebSessionStoreOptions = {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
};

function copySession(entry: WebSessionEntry): WebSessionRecord {
  return {
    id: entry.id,
    csrfToken: entry.csrfToken,
    rateLimitId: entry.rateLimitId,
    pbUrl: entry.pbUrl,
    auth: { token: entry.auth.token, record: entry.auth.record },
    publicConfig: entry.publicConfig,
    runtime: entry.runtime,
    presenceLabel: entry.presenceLabel,
    createdAt: entry.createdAt,
    lastActiveAt: entry.lastActiveAt,
  };
}

export class WebSessionStore {
  private readonly sessions = new Map<string, WebSessionEntry>();
  private readonly sessionsByRateLimitId = new Map<string, WebSessionEntry>();
  private readonly pendingDisposals = new Set<Promise<void>>();
  private readonly destroyListeners = new Set<(rateLimitId: string) => void>();
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly idleTimeoutMs: number;
  private readonly absoluteTimeoutMs: number;

  constructor(options: WebSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? cryptoRandomBytes;
    this.idleTimeoutMs = options.idleTimeoutMs ?? WEB_SESSION_IDLE_TIMEOUT_MS;
    this.absoluteTimeoutMs = options.absoluteTimeoutMs ?? WEB_SESSION_ABSOLUTE_TIMEOUT_MS;
  }

  get size(): number {
    return this.sessions.size;
  }

  create(input: WebSessionCreateInput): WebSessionRecord {
    const now = this.now();
    const entry: WebSessionEntry = {
      id: this.createOpaqueValue(),
      csrfToken: this.createOpaqueValue(),
      rateLimitId: this.createOpaqueValue(),
      pbUrl: input.pbUrl,
      auth: { token: input.auth.token, record: input.auth.record },
      publicConfig: input.publicConfig,
      runtime: input.runtime,
      presenceLabel: input.presenceLabel ?? 'Web · Other · LAN/VPN client',
      createdAt: now,
      lastActiveAt: now,
      refreshAuth: input.refresh,
      disposeAuth: input.dispose,
      cleanups: new Set(),
      eventSinks: new Set(),
      generation: 0,
      revoked: false,
      destroyNotified: false,
    };
    this.sessions.set(entry.id, entry);
    this.sessionsByRateLimitId.set(entry.rateLimitId, entry);
    return copySession(entry);
  }

  get(id: string, options: { touch?: boolean } = {}): WebSessionRecord | null {
    const entry = this.getEntry(id, options.touch !== false);
    return entry ? copySession(entry) : null;
  }

  registerCleanup(id: string, cleanup: () => void | Promise<void>): boolean {
    const entry = this.getEntry(id, false);
    if (!entry) return false;
    entry.cleanups.add(cleanup);
    return true;
  }

  unregisterCleanupByRateLimitId(rateLimitId: string, cleanup: () => void | Promise<void>): void {
    this.sessionsByRateLimitId.get(rateLimitId)?.cleanups.delete(cleanup);
  }

  onDestroyed(listener: (rateLimitId: string) => void): () => void {
    this.destroyListeners.add(listener);
    return () => this.destroyListeners.delete(listener);
  }

  subscribeEvents(id: string, sink: (event: string, data: unknown) => void): () => void {
    const entry = this.sessions.get(id);
    if (!entry) return () => undefined;
    entry.eventSinks.add(sink);
    return () => entry.eventSinks.delete(sink);
  }

  publish(id: string, event: string, data: unknown): boolean {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(event)) return false;
    const entry = this.getEntry(id, false);
    if (!entry) return false;
    for (const sink of entry.eventSinks) sink(event, data);
    return true;
  }

  publishAll(event: string, data: unknown): void {
    for (const id of this.sessions.keys()) this.publish(id, event, data);
  }

  async refresh(id: string): Promise<WebSessionRecord | null> {
    const entry = this.getEntry(id, false);
    if (!entry || entry.revoked) return null;
    if (entry.refreshPromise) return entry.refreshPromise;
    const generation = entry.generation;
    const pending = this.refreshEntry(id, entry, generation);
    entry.refreshPromise = pending;
    void pending.finally(() => {
      if (entry.refreshPromise === pending) entry.refreshPromise = undefined;
    });
    return pending;
  }

  private async refreshEntry(
    id: string,
    entry: WebSessionEntry,
    generation: number,
  ): Promise<WebSessionRecord | null> {
    try {
      const auth = await entry.refreshAuth();
      const now = this.now();
      if (entry.revoked || entry.generation !== generation || this.sessions.get(id) !== entry) {
        return null;
      }
      if (this.isExpired(entry, now)) {
        await this.destroy(id);
        return null;
      }
      this.sessions.delete(id);
      entry.generation += 1;
      entry.id = this.createOpaqueValue();
      entry.csrfToken = this.createOpaqueValue();
      entry.auth = { token: auth.token, record: auth.record };
      entry.lastActiveAt = now;
      this.sessions.set(entry.id, entry);
      return copySession(entry);
    } catch {
      if (!entry.revoked && entry.generation === generation && this.sessions.get(id) === entry) {
        await this.destroy(id);
      }
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    await this.destroyEntry(entry);
  }

  async destroyByRateLimitId(rateLimitId: string): Promise<void> {
    const entry = this.sessionsByRateLimitId.get(rateLimitId);
    if (!entry) return;
    await this.destroyEntry(entry);
  }

  private async destroyEntry(entry: WebSessionEntry): Promise<void> {
    if (entry.revoked) {
      await this.disposeEntryOnce(entry);
      return;
    }
    entry.revoked = true;
    entry.generation += 1;
    for (const [key, candidate] of this.sessions) {
      if (candidate === entry) this.sessions.delete(key);
    }
    this.sessionsByRateLimitId.delete(entry.rateLimitId);
    this.notifyDestroyed(entry);
    await this.disposeEntryOnce(entry);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessionsByRateLimitId.values()].map((entry) => this.destroyEntry(entry)),
    );
    await this.finishedDisposals();
  }

  async finishedDisposals(): Promise<void> {
    await Promise.all(this.pendingDisposals);
  }

  private getEntry(id: string, touch: boolean): WebSessionEntry | null {
    const entry = this.sessions.get(id);
    if (!entry || entry.revoked) return null;
    const now = this.now();
    if (this.isExpired(entry, now)) {
      void this.destroy(id);
      return null;
    }
    if (touch) entry.lastActiveAt = now;
    return entry;
  }

  private createOpaqueValue(): string {
    return Buffer.from(this.randomBytes(32)).toString('base64url');
  }

  private isExpired(entry: WebSessionEntry, now: number): boolean {
    return (
      now - entry.lastActiveAt >= this.idleTimeoutMs ||
      now - entry.createdAt >= this.absoluteTimeoutMs
    );
  }

  private notifyDestroyed(entry: WebSessionEntry): void {
    if (entry.destroyNotified) return;
    entry.destroyNotified = true;
    for (const listener of this.destroyListeners) {
      try {
        listener(entry.rateLimitId);
      } catch {
        // Session invalidation must not depend on an observer.
      }
    }
  }

  private disposeEntryOnce(entry: WebSessionEntry): Promise<void> {
    if (entry.disposePromise) return entry.disposePromise;
    const disposal = this.disposeEntry(entry);
    entry.disposePromise = disposal;
    this.pendingDisposals.add(disposal);
    void disposal.finally(() => this.pendingDisposals.delete(disposal));
    return disposal;
  }

  private async disposeEntry(entry: WebSessionEntry): Promise<void> {
    const actions = [...entry.cleanups];
    if (entry.disposeAuth) actions.push(entry.disposeAuth);
    await Promise.allSettled(actions.map(async (action) => action()));
  }
}
