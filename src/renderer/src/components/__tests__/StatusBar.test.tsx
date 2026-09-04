import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../../services/pocketbase';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';

let mockState: ConnectionState = 'online';
let registeredListener: ((state: ConnectionState) => void) | null = null;

vi.mock('../../services/pocketbase', () => ({
  getConnectionState: () => mockState,
  onConnectionStateChange: (listener: (state: ConnectionState) => void) => {
    registeredListener = listener;
    return vi.fn();
  },
}));

import { StatusBarLive } from '../StatusBar';

describe('StatusBarLive', () => {
  beforeEach(() => {
    mockState = 'online';
    registeredListener = null;
    globalThis.api = { runtime: ELECTRON_RUNTIME } as never;
  });

  it('shows the current PocketBase connection state instead of a static connected label', () => {
    render(<StatusBarLive />);

    expect(screen.getByText('Connected')).toBeInTheDocument();

    act(() => {
      registeredListener?.('offline');
    });

    expect(screen.getByText('Offline — using cached data')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('marks the visual state for non-online connection states', () => {
    mockState = 'reconnecting';

    render(<StatusBarLive />);

    const indicator = screen.getByText('Reconnecting...').closest('.status-bar-live');
    expect(indicator).toHaveClass('status-bar-live--reconnecting');
    expect(indicator).toHaveAttribute('data-connection-state', 'reconnecting');
  });

  it('uses the same actionable auth failure copy as the removed floating banner', () => {
    mockState = 'auth-failed';

    render(<StatusBarLive />);

    expect(
      screen.getByText('Sign-in failed — check the passphrase in Settings'),
    ).toBeInTheDocument();
  });

  it('does not claim Relay Web has an offline cache', () => {
    mockState = 'offline';
    globalThis.api = { runtime: WEB_RUNTIME } as never;

    render(<StatusBarLive />);

    expect(screen.getByText('Offline — reconnect to continue')).toBeInTheDocument();
    expect(screen.queryByText(/using cached data/i)).not.toBeInTheDocument();
  });
});
