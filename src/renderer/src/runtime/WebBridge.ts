import type { BridgeAPI } from '@shared/ipc';
import {
  RELAY_WEB_API_PREFIX,
  type WebSessionBootstrap,
  type WebSessionBootstrapResult,
} from '@shared/webApi';
import { createBrowserActions, type BrowserActions } from './browserActions';
import {
  type RequestOptions,
  type WebBridgeContext,
  type WebBridgeRequest,
  type WebBridgeSubscribe,
} from './webBridge/context';
import { createDesktopFallbackApi } from './webBridge/desktopFallbackApi';
import { createKnowledgeWebApi } from './webBridge/knowledgeWebApi';
import { createOperationalWebApi } from './webBridge/operationalWebApi';
import { createPrivilegedWebApi } from './webBridge/privilegedWebApi';

export type { WebBridgeRequest, WebBridgeSubscribe } from './webBridge/context';

type WebBridgeOptions = {
  fetcher?: typeof fetch;
  request?: WebBridgeRequest;
  subscribe?: WebBridgeSubscribe;
  actions?: BrowserActions;
  refreshSession?: () => Promise<WebSessionBootstrapResult>;
};

function createRequest(session: WebSessionBootstrap, fetcher: typeof fetch): WebBridgeRequest {
  return async <T>(path: string, options: RequestOptions): Promise<T> => {
    const mutating = options.method !== 'GET';
    const response = await fetcher(`${RELAY_WEB_API_PREFIX}${path}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      method: options.method,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(mutating
          ? { 'Content-Type': 'application/json', 'X-Relay-CSRF': session.csrfToken }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok) throw new Error('Relay Web request unavailable');
    return (await response.json()) as T;
  };
}

export function createWebEventSubscriber(
  EventSourceConstructor?: typeof EventSource,
): WebBridgeSubscribe {
  let source: EventSource | null = null;
  let listenerCount = 0;
  return <T>(event: string, callback: (value: T) => void): (() => void) => {
    const Source = EventSourceConstructor ?? globalThis.EventSource;
    if (!Source) return () => undefined;
    source ??= new Source(`${RELAY_WEB_API_PREFIX}/session/events`);
    const activeSource = source;
    const listener = (message: MessageEvent<string>) => {
      try {
        callback(JSON.parse(message.data) as T);
      } catch {
        // Ignore malformed or stale event payloads.
      }
    };
    activeSource.addEventListener(event, listener as EventListener);
    listenerCount += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      activeSource.removeEventListener(event, listener as EventListener);
      listenerCount -= 1;
      if (listenerCount === 0 && source === activeSource) {
        activeSource.close();
        source = null;
      }
    };
  };
}

export function createWebBridge(
  session: WebSessionBootstrap,
  options: WebBridgeOptions = {},
): BridgeAPI {
  const fetcher = options.fetcher ?? fetch;
  const context = {
    session,
    fetcher,
    request: options.request ?? createRequest(session, fetcher),
    subscribe: options.subscribe ?? createWebEventSubscriber(),
    actions: options.actions ?? createBrowserActions(),
    ...(options.refreshSession ? { refreshSession: options.refreshSession } : {}),
  } satisfies WebBridgeContext;

  return {
    ...createOperationalWebApi(context),
    ...createPrivilegedWebApi(context),
    ...createKnowledgeWebApi(context),
    ...createDesktopFallbackApi(context),
  } satisfies BridgeAPI;
}
