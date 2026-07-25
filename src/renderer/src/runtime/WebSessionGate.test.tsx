import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { WebSessionBootstrap } from '@shared/webApi';
import { WEB_RUNTIME } from '@shared/runtime';
import {
  WebSessionGate,
  type WebSessionClientPort,
  type WebSessionAppProps,
} from './WebSessionGate';

const mockLoadAuthSession = vi.fn();
vi.mock('../services/pocketbase', () => ({
  loadAuthSession: (...args: unknown[]) => mockLoadAuthSession(...args),
}));

const PB_URL = ['http', '://', 'relay-server', ':8090'].join('');
const LAN_ADDRESS = ['192', '168', '1', '25'].join('.');
const SESSION: WebSessionBootstrap = {
  csrfToken: 'csrf-value',
  pbUrl: PB_URL,
  auth: { token: 'app-user-token', record: null },
  publicConfig: {
    mode: 'server',
    port: 8090,
    bindHost: '0.0.0.0',
    lanIp: LAN_ADDRESS,
  },
  runtime: WEB_RUNTIME,
};

function RelayShell(props: Readonly<WebSessionAppProps>) {
  return (
    <div>
      <span>Relay shell · {globalThis.api?.runtime.label}</span>
      <button type="button" onClick={() => void props.onWebReauthenticate?.('reauth-passphrase')}>
        Reauthenticate
      </button>
    </div>
  );
}

describe('WebSessionGate', () => {
  it('activates an authenticated session before loading the shared app', async () => {
    const calls: string[] = [];
    const client: WebSessionClientPort = {
      bootstrap: vi.fn(async () => {
        calls.push('bootstrap');
        return { ok: true, session: SESSION };
      }),
      login: vi.fn(),
      activate: vi.fn(async () => {
        calls.push('activate');
        globalThis.api = { runtime: WEB_RUNTIME } as BridgeAPI;
      }),
    };
    const appLoader = vi.fn(async () => {
      calls.push('load-app');
      return { default: RelayShell };
    });

    render(<WebSessionGate client={client} appLoader={appLoader} />);

    expect(screen.getByText('Initializing Relay Web...')).toBeInTheDocument();
    expect(await screen.findByText('Relay shell · Web')).toBeInTheDocument();
    expect(calls).toEqual(['bootstrap', 'activate', 'load-app']);
    expect(client.bootstrap).toHaveBeenCalledOnce();
    expect(client.activate).toHaveBeenCalledOnce();
    expect(appLoader).toHaveBeenCalledOnce();
  });

  it('renders the sign-in slot without loading the app when no session exists', async () => {
    const client: WebSessionClientPort = {
      bootstrap: vi.fn(async () => ({ ok: false, error: 'unauthenticated' as const })),
      login: vi.fn(),
      activate: vi.fn(),
    };
    const appLoader = vi.fn(async () => ({ default: RelayShell }));

    render(
      <WebSessionGate
        client={client}
        appLoader={appLoader}
        renderSignIn={() => <div>Sign in to Relay Web</div>}
      />,
    );

    expect(await screen.findByText('Sign in to Relay Web')).toBeInTheDocument();
    expect(client.activate).not.toHaveBeenCalled();
    expect(appLoader).not.toHaveBeenCalled();
  });

  it('keeps the default app loader stable while showing sign-in', async () => {
    const client: WebSessionClientPort = {
      bootstrap: vi.fn(async () => ({ ok: false, error: 'unauthenticated' as const })),
      login: vi.fn(),
      activate: vi.fn(),
    };

    render(<WebSessionGate client={client} renderSignIn={() => <div>Stable Relay sign-in</div>} />);

    expect(await screen.findByText('Stable Relay sign-in')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.bootstrap).toHaveBeenCalledOnce();
  });

  it('authenticates from the default browser sign-in before loading the shared app', async () => {
    const client: WebSessionClientPort = {
      bootstrap: vi.fn(async () => ({ ok: false, error: 'unauthenticated' as const })),
      login: vi.fn(async () => ({ ok: true, session: SESSION })),
      activate: vi.fn(async () => {
        globalThis.api = { runtime: WEB_RUNTIME } as BridgeAPI;
      }),
    };
    const appLoader = vi.fn(async () => ({ default: RelayShell }));
    render(<WebSessionGate client={client} appLoader={appLoader} />);

    const passphrase = await screen.findByLabelText('Connection passphrase');
    expect(appLoader).not.toHaveBeenCalled();
    fireEvent.change(passphrase, { target: { value: 'fixture-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Relay shell · Web')).toBeVisible();
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake passphrase asserts the exact web-session login payload.
    expect(client.login).toHaveBeenCalledWith({ passphrase: 'fixture-passphrase' });
    expect(client.activate).toHaveBeenCalledWith(SESSION);
    expect(appLoader).toHaveBeenCalledOnce();
  });

  it('replaces the bridge in place when the mounted app reauthenticates', async () => {
    const client: WebSessionClientPort = {
      bootstrap: vi.fn(async () => ({ ok: true, session: SESSION })),
      login: vi.fn(async () => ({ ok: true, session: { ...SESSION, csrfToken: 'next-csrf' } })),
      activate: vi.fn(async () => {
        globalThis.api = { runtime: WEB_RUNTIME } as BridgeAPI;
      }),
    };
    render(<WebSessionGate client={client} appLoader={async () => ({ default: RelayShell })} />);

    expect(await screen.findByText('Relay shell · Web')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reauthenticate' }));

    await vi.waitFor(() => {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake passphrase asserts the reauthentication payload.
      expect(client.login).toHaveBeenCalledWith({ passphrase: 'reauth-passphrase' });
      expect(mockLoadAuthSession).toHaveBeenCalledWith(SESSION.auth);
    });
    expect(client.activate).toHaveBeenLastCalledWith({ ...SESSION, csrfToken: 'next-csrf' });
    expect(screen.getByText('Relay shell · Web')).toBeInTheDocument();
  });
});
