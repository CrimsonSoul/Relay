import {
  RELAY_WEB_API_PREFIX,
  WebSessionBootstrapResultSchema,
  WebSessionLoginInputSchema,
  type WebSessionBootstrap,
  type WebSessionBootstrapResult,
  type WebSessionLoginInput,
} from '@shared/webApi';
import { createWebBridge, createWebEventSubscriber } from './WebBridge';

type WebSessionClientOptions = {
  fetcher?: typeof fetch;
  install?: (session: WebSessionBootstrap) => void | (() => void);
};

// Every activate() installs a fresh bridge, but the event stream must outlive it. A per-bridge
// subscriber left long-lived listeners attached to the previous EventSource while new listeners
// opened another, so each refresh leaked a live SSE stream until the server's per-session stream
// limit started rejecting them.
const sharedEventSubscriber = createWebEventSubscriber();

type WebLogoutResult = { ok: true } | { ok: false; error: 'unavailable' };

export class WebSessionClient {
  readonly #fetcher: typeof fetch;
  readonly #install: NonNullable<WebSessionClientOptions['install']>;
  #activeSession: WebSessionBootstrap | null = null;
  #cleanup: (() => void) | null = null;

  constructor(options: WebSessionClientOptions = {}) {
    const fetcher = options.fetcher ?? fetch;
    this.#fetcher = (input, init) => fetcher(input, init);
    this.#install =
      options.install ??
      ((session) => {
        const api = createWebBridge(session, {
          fetcher: this.#fetcher,
          subscribe: sharedEventSubscriber,
          refreshSession: () => this.refresh(),
        });
        globalThis.api = api;
        return () => {
          if (globalThis.api === api) globalThis.api = undefined;
        };
      });
  }

  bootstrap(): Promise<WebSessionBootstrapResult> {
    return this.requestSession(`${RELAY_WEB_API_PREFIX}/session/bootstrap`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  }

  login(input: WebSessionLoginInput): Promise<WebSessionBootstrapResult> {
    const validated = WebSessionLoginInputSchema.safeParse(input);
    if (!validated.success) return Promise.resolve({ ok: false, error: 'unauthenticated' });
    return this.requestSession(`${RELAY_WEB_API_PREFIX}/session/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(validated.data),
    });
  }

  async refresh(): Promise<WebSessionBootstrapResult> {
    const csrfToken = this.#activeSession?.csrfToken;
    if (!csrfToken) return { ok: false, error: 'unauthenticated' };
    const result = await this.requestSession(`${RELAY_WEB_API_PREFIX}/session/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Relay-CSRF': csrfToken },
    });
    if (result.ok) await this.activate(result.session);
    return result;
  }

  async logout(): Promise<WebLogoutResult> {
    const csrfToken = this.#activeSession?.csrfToken;
    if (!csrfToken) {
      this.deactivate();
      return { ok: true };
    }
    try {
      const response = await this.#fetcher(`${RELAY_WEB_API_PREFIX}/session/logout`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Relay-CSRF': csrfToken },
        method: 'POST',
        redirect: 'error',
      });
      const body = (await response.json()) as unknown;
      return body && typeof body === 'object' && (body as { ok?: unknown }).ok === true
        ? { ok: true }
        : { ok: false, error: 'unavailable' };
    } catch {
      return { ok: false, error: 'unavailable' };
    } finally {
      this.deactivate();
    }
  }

  async activate(session: WebSessionBootstrap): Promise<void> {
    this.deactivate();
    this.#activeSession = session;
    this.#cleanup = this.#install(session) ?? null;
  }

  private deactivate(): void {
    this.#cleanup?.();
    this.#cleanup = null;
    this.#activeSession = null;
  }

  private async requestSession(
    url: string,
    init: Pick<RequestInit, 'body' | 'headers' | 'method'>,
  ): Promise<WebSessionBootstrapResult> {
    try {
      const response = await this.#fetcher(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
        redirect: 'error',
      });
      const parsed = WebSessionBootstrapResultSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : { ok: false, error: 'unavailable' };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }
}

export const webSessionClient = new WebSessionClient();
