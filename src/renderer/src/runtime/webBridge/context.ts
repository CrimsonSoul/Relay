import type { BridgeAPI, IpcResult, PrivilegedIpcResult } from '@shared/ipc';
import type { WebSessionBootstrap, WebSessionBootstrapResult } from '@shared/webApi';
import type { z } from 'zod';
import type { BrowserActions } from '../browserActions';

export type RequestOptions = {
  method: 'GET' | 'POST';
  body?: unknown;
};

export type WebBridgeRequest = <T>(path: string, options: RequestOptions) => Promise<T>;
export type WebBridgeSubscribe = <T>(event: string, callback: (value: T) => void) => () => void;

export type WebBridgeContext = {
  session: WebSessionBootstrap;
  /**
   * The CSRF token to send right now. A session refresh rotates it, so requests (and each chunk of
   * a long upload) read it when they are sent instead of keeping the value from bridge creation.
   */
  csrfToken: () => string;
  fetcher: typeof fetch;
  request: WebBridgeRequest;
  subscribe: WebBridgeSubscribe;
  actions: BrowserActions;
  refreshSession?: () => Promise<WebSessionBootstrapResult>;
};

export function browserPlatform(): BridgeAPI['platform'] {
  return globalThis.navigator?.platform?.toLowerCase().includes('mac') ? 'darwin' : 'win32';
}

export function unavailable<T = void>(message: string): IpcResult<T> {
  return { success: false, error: message };
}

export function privilegedUnavailable<T>(): PrivilegedIpcResult<T> {
  return { ok: false, error: 'offline' };
}

export function noopSubscription<T>(_callback: T): () => void {
  return () => undefined;
}

export async function validatedRequest<T>(
  request: WebBridgeRequest,
  path: string,
  options: RequestOptions,
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await request(path, options));
  if (!parsed.success) throw new Error('Relay Web returned an invalid response');
  return parsed.data;
}
