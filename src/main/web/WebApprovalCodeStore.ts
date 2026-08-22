import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrivilegedApprovalOperation, PrivilegedApprovalRequestView } from '@shared/ipc';

export const WEB_APPROVAL_CODE_TTL_MS = 10 * 60 * 1_000;
export const WEB_APPROVAL_MAX_ATTEMPTS = 5;

export type WebApprovalOperation = PrivilegedApprovalOperation;
export type WebApprovalRequest = PrivilegedApprovalRequestView;

export type WebApprovalCode = {
  request: WebApprovalRequest;
  code: string;
};

type WebApprovalEntry = {
  request: WebApprovalRequest;
  sessionId: string;
  code: string | null;
  failedAttempts: number;
  expiresAtMs: number;
};

type WebApprovalCodeStoreOptions = {
  now?: () => number;
  randomCode?: () => string;
  createId?: () => string;
};

function publicRequest(entry: WebApprovalEntry): WebApprovalRequest {
  return { ...entry.request };
}

function equalCode(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class WebApprovalCodeStore {
  private readonly entries = new Map<string, WebApprovalEntry>();
  private readonly listeners = new Set<(requests: WebApprovalRequest[]) => void>();
  private readonly now: () => number;
  private readonly randomCode: () => string;
  private readonly createId: () => string;

  constructor(options: WebApprovalCodeStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomCode = options.randomCode ?? (() => String(randomInt(100_000, 1_000_000)));
    this.createId = options.createId ?? randomUUID;
  }

  request(input: {
    sessionId: string;
    operation: WebApprovalOperation;
    sourceLabel: string;
  }): WebApprovalRequest {
    this.removeExpired();
    for (const [requestId, entry] of this.entries) {
      if (entry.sessionId === input.sessionId && entry.request.operation === input.operation) {
        this.entries.delete(requestId);
      }
    }
    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + WEB_APPROVAL_CODE_TTL_MS;
    const request: WebApprovalRequest = {
      requestId: this.createId(),
      operation: input.operation,
      sourceLabel: input.sourceLabel,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    this.entries.set(request.requestId, {
      request,
      sessionId: input.sessionId,
      code: null,
      failedAttempts: 0,
      expiresAtMs,
    });
    this.emit();
    return { ...request };
  }

  listPending(): WebApprovalRequest[] {
    this.removeExpired();
    return [...this.entries.values()].map(publicRequest);
  }

  get(requestId: string): WebApprovalRequest | null {
    this.removeExpired();
    const entry = this.entries.get(requestId);
    return entry ? publicRequest(entry) : null;
  }

  getForSession(
    requestId: string,
    sessionId: string,
    operation: WebApprovalOperation,
  ): WebApprovalRequest | null {
    this.removeExpired();
    const entry = this.entries.get(requestId);
    return entry?.sessionId === sessionId && entry.request.operation === operation
      ? publicRequest(entry)
      : null;
  }

  generate(requestId: string): WebApprovalCode | null {
    this.removeExpired();
    const entry = this.entries.get(requestId);
    if (!entry) return null;
    entry.code ??= this.randomCode();
    return { request: publicRequest(entry), code: entry.code };
  }

  consume(input: {
    requestId: string;
    sessionId: string;
    operation: WebApprovalOperation;
    code: string;
  }): boolean {
    this.removeExpired();
    const entry = this.entries.get(input.requestId);
    if (!entry) return false;
    const approved =
      entry.sessionId === input.sessionId &&
      entry.request.operation === input.operation &&
      entry.code !== null &&
      equalCode(input.code, entry.code);
    if (approved) {
      this.entries.delete(input.requestId);
      this.emit();
      return true;
    }
    if (entry.sessionId === input.sessionId && entry.request.operation === input.operation) {
      entry.failedAttempts += 1;
      if (entry.failedAttempts >= WEB_APPROVAL_MAX_ATTEMPTS) {
        this.entries.delete(input.requestId);
        this.emit();
      }
    }
    return false;
  }

  cancel(requestId: string): boolean {
    const removed = this.entries.delete(requestId);
    if (removed) this.emit();
    return removed;
  }

  clearSession(sessionId: string): void {
    let changed = false;
    for (const [requestId, entry] of this.entries) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(requestId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  clear(): void {
    const changed = this.entries.size > 0;
    this.entries.clear();
    if (changed) this.emit();
  }

  subscribe(listener: (requests: WebApprovalRequest[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private removeExpired(): void {
    const now = this.now();
    let changed = false;
    for (const [requestId, entry] of this.entries) {
      if (now >= entry.expiresAtMs) {
        this.entries.delete(requestId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    const requests = [...this.entries.values()].map(publicRequest);
    for (const listener of this.listeners) listener(requests);
  }
}
