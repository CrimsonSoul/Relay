import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from 'react';
import type { WebSessionBootstrap, WebSessionBootstrapResult } from '@shared/webApi';
import { WebLoginScreen } from '../components/WebLoginScreen';
import { loadAuthSession } from '../services/pocketbase';
import { webSessionClient } from './WebSessionClient';

export type WebSessionAppProps = {
  onWebSessionRequired?: () => void;
  onWebReauthenticate?: (passphrase: string) => Promise<boolean>;
};

export type WebSessionClientPort = {
  bootstrap(): Promise<WebSessionBootstrapResult>;
  login(input: { passphrase: string }): Promise<WebSessionBootstrapResult>;
  activate(session: WebSessionBootstrap): Promise<void>;
};

type AppModule = { default: ComponentType<WebSessionAppProps> };
type GateState =
  | { stage: 'checking' }
  | { stage: 'sign-in' }
  | { stage: 'ready'; App: ComponentType<WebSessionAppProps> }
  | { stage: 'error' };

const DEFAULT_CLIENT: WebSessionClientPort = webSessionClient;
const DEFAULT_APP_LOADER = () => import('../App');

async function resolveSession(
  client: WebSessionClientPort,
  appLoader: () => Promise<AppModule>,
): Promise<GateState> {
  const result = await client.bootstrap();
  if (!result.ok) return { stage: result.error === 'unauthenticated' ? 'sign-in' : 'error' };
  await client.activate(result.session);
  const { default: App } = await appLoader();
  return { stage: 'ready', App };
}

function defaultSignIn(login: (passphrase: string) => Promise<boolean>): ReactElement {
  return (
    <WebLoginScreen serverLabel={globalThis.location?.hostname || 'Relay server'} onLogin={login} />
  );
}

export function WebSessionGate({
  client = DEFAULT_CLIENT,
  appLoader = DEFAULT_APP_LOADER,
  renderSignIn = defaultSignIn,
}: Readonly<{
  client?: WebSessionClientPort;
  appLoader?: () => Promise<AppModule>;
  renderSignIn?: (login: (passphrase: string) => Promise<boolean>) => ReactElement;
}>): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GateState>({ stage: 'checking' });
  const resolutionRef = useRef<{ attempt: number; promise: Promise<GateState> } | null>(null);

  const retry = useCallback(() => {
    resolutionRef.current = null;
    setState({ stage: 'checking' });
    setAttempt((current) => current + 1);
  }, []);

  const requestSignIn = useCallback(() => {
    resolutionRef.current = null;
    setState({ stage: 'sign-in' });
  }, []);

  const signIn = useCallback(
    async (passphrase: string) => {
      const result = await client.login({ passphrase });
      if (!result.ok) return false;
      setState({ stage: 'checking' });
      try {
        await client.activate(result.session);
        const { default: App } = await appLoader();
        setState({ stage: 'ready', App });
        return true;
      } catch {
        setState({ stage: 'error' });
        return false;
      }
    },
    [appLoader, client],
  );

  const reauthenticate = useCallback(
    async (passphrase: string) => {
      const result = await client.login({ passphrase });
      if (!result.ok) return false;
      try {
        await client.activate(result.session);
        loadAuthSession(result.session.auth);
        return true;
      } catch {
        return false;
      }
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    if (!resolutionRef.current || resolutionRef.current.attempt !== attempt) {
      resolutionRef.current = { attempt, promise: resolveSession(client, appLoader) };
    }
    void resolutionRef.current.promise.then(
      (next) => {
        if (active) setState(next);
      },
      () => {
        if (active) setState({ stage: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [appLoader, attempt, client]);

  if (state.stage === 'checking') {
    return (
      <main className="app-state" aria-live="polite">
        <div className="app-state__spinner" />
        <p className="app-state__text">Initializing Relay Web...</p>
      </main>
    );
  }

  if (state.stage === 'sign-in') return renderSignIn(signIn);

  if (state.stage === 'error') {
    return (
      <main className="app-state" role="alert">
        <p className="app-state__text">Relay Web is temporarily unavailable.</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </main>
    );
  }

  const { App } = state;
  return <App onWebSessionRequired={requestSignIn} onWebReauthenticate={reauthenticate} />;
}
