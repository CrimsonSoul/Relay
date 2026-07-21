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
  refresh: () => Promise<PbAuthSession>;
  dispose?: () => void | Promise<void>;
};

export type WebSessionRecord = {
  id: string;
  csrfToken: string;
  pbUrl: string;
  auth: PbAuthSession;
  publicConfig: Extract<PublicRelayConfig, { mode: 'server' }>;
  runtime: RelayRuntimeDescriptor;
  createdAt: number;
  lastActiveAt: number;
};

type WebSessionEntry = WebSessionRecord & {
  refreshAuth: WebSessionCreateInput['refresh'];
  disposeAuth?: WebSessionCreateInput['dispose'];
  cleanups: Set<() => void | Promise<void>>;
  eventSinks: Set<(event: string, data: unknown) => void>;
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
    pbUrl: entry.pbUrl,
    auth: { token: entry.auth.token, record: entry.auth.record },
    publicConfig: entry.publicConfig,
    runtime: entry.runtime,
    createdAt: entry.createdAt,
    lastActiveAt: entry.lastActiveAt,
  };
}

export class WebSessionStore {
  private readonly sessions = new Map<string, WebSessionEntry>();
  private readonly pendingDisposals = new Set<Promise<void>>();
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
      pbUrl: input.pbUrl,
      auth: { token: input.auth.token, record: input.auth.record },
      publicConfig: input.publicConfig,
      runtime: input.runtime,
      createdAt: now,
      lastActiveAt: now,
      refreshAuth: input.refresh,
      disposeAuth: input.dispose,
      cleanups: new Set(),
      eventSinks: new Set(),
    };
    this.sessions.set(entry.id, entry);
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

  unregisterCleanup(id: string, cleanup: () => void | Promise<void>): void {
    this.sessions.get(id)?.cleanups.delete(cleanup);
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
    if (!entry) return null;
    try {
      const auth = await entry.refreshAuth();
      const now = this.now();
      this.sessions.delete(id);
      entry.id = this.createOpaqueValue();
      entry.csrfToken = this.createOpaqueValue();
      entry.auth = { token: auth.token, record: auth.record };
      entry.lastActiveAt = now;
      this.sessions.set(entry.id, entry);
      return copySession(entry);
    } catch {
      await this.destroy(id);
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    this.sessions.delete(id);
    const disposal = this.disposeEntry(entry);
    this.pendingDisposals.add(disposal);
    try {
      await disposal;
    } finally {
      this.pendingDisposals.delete(disposal);
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.destroy(id)));
    await this.finishedDisposals();
  }

  async finishedDisposals(): Promise<void> {
    await Promise.all([...this.pendingDisposals]);
  }

  private getEntry(id: string, touch: boolean): WebSessionEntry | null {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    const now = this.now();
    const idleExpired = now - entry.lastActiveAt >= this.idleTimeoutMs;
    const absoluteExpired = now - entry.createdAt >= this.absoluteTimeoutMs;
    if (idleExpired || absoluteExpired) {
      void this.destroy(id);
      return null;
    }
    if (touch) entry.lastActiveAt = now;
    return entry;
  }

  private createOpaqueValue(): string {
    return Buffer.from(this.randomBytes(32)).toString('base64url');
  }

  private async disposeEntry(entry: WebSessionEntry): Promise<void> {
    const actions = [...entry.cleanups];
    if (entry.disposeAuth) actions.push(entry.disposeAuth);
    await Promise.allSettled(actions.map(async (action) => action()));
  }
}
