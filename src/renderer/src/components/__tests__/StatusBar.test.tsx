import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../../services/pocketbase';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';

let mockState: ConnectionState = 'online';
let registeredListener: ((state: ConnectionState) => void) | null = null;
let changeBeforeSubscribe: ConnectionState | null = null;

vi.mock('../../services/pocketbase', () => ({
  getConnectionState: () => mockState,
  onConnectionStateChange: (listener: (state: ConnectionState) => void) => {
    // A transition that lands after render but before the subscription exists notifies nobody.
    if (changeBeforeSubscribe) mockState = changeBeforeSubscribe;
    registeredListener = (state) => {
      mockState = state;
      listener(state);
    };
    return vi.fn();
  },
}));

import { StatusBarLive } from '../StatusBar';

describe('StatusBarLive', () => {
  beforeEach(() => {
    mockState = 'online';
    registeredListener = null;
    changeBeforeSubscribe = null;
    globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
  });

  it('shows the current PocketBase connection state instead of a static connected label', () => {
    render(<StatusBarLive />);

    expect(screen.getByText('Relay server connected')).toBeInTheDocument();

    act(() => {
      registeredListener?.('offline');
    });

    expect(screen.getByText('Relay server offline — using cached data')).toBeInTheDocument();
    expect(screen.queryByText('Relay server connected')).not.toBeInTheDocument();
  });

  it('shows a connection change that lands before the footer subscribes', () => {
    changeBeforeSubscribe = 'offline';
    render(<StatusBarLive />);

    expect(screen.getByText('Relay server offline — using cached data')).toBeInTheDocument();
  });

  it('marks the visual state for non-online connection states', () => {
    mockState = 'reconnecting';

    render(<StatusBarLive />);

    const indicator = screen.getByText('Reconnecting to Relay server…').closest('.status-bar-live');
    expect(indicator).toHaveClass('status-bar-live--reconnecting');
    expect(indicator).toHaveAttribute('data-connection-state', 'reconnecting');
  });

  it('announces the connection state through a polite live region holding only text', () => {
    mockState = 'offline';

    render(<StatusBarLive />);

    const live = screen.getByText('Relay server offline — using cached data');
    expect(live.tagName).toBe('OUTPUT');
    expect(live.querySelector('button')).toBeNull();
  });

  it('uses the same actionable auth failure copy as the removed floating banner', () => {
    mockState = 'auth-failed';

    render(<StatusBarLive />);

    expect(
      screen.getByText('Relay server sign-in failed — check the passphrase in Settings'),
    ).toBeInTheDocument();
  });

  it('does not claim Relay Web has an offline cache', () => {
    mockState = 'offline';
    globalThis.api = { runtime: WEB_RUNTIME } as never;

    render(<StatusBarLive />);

    expect(screen.getByText('Relay server offline — reconnect to continue')).toBeInTheDocument();
    expect(screen.queryByText(/using cached data/i)).not.toBeInTheDocument();
  });
});
