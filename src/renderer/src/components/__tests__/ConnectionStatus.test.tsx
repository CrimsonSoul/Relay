import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pocketbase service
// ---------------------------------------------------------------------------

type ConnectionState = 'connecting' | 'online' | 'offline' | 'reconnecting';

let mockState: ConnectionState = 'online';
let registeredListener: ((state: ConnectionState) => void) | null = null;

vi.mock('../../services/pocketbase', () => ({
  getConnectionState: () => mockState,
  onConnectionStateChange: (listener: (state: ConnectionState) => void) => {
    registeredListener = listener;
    return () => {
      registeredListener = null;
    };
  },
}));

import { ConnectionStatus } from '../ConnectionStatus';

describe('ConnectionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = 'online';
    registeredListener = null;
  });

  // ── Online State ──

  it('renders nothing when state is online', () => {
    mockState = 'online';
    const { container } = render(<ConnectionStatus />);
    expect(container.querySelector('.connection-status')).toBeNull();
  });

  // ── Offline State ──

  it('shows offline banner when state is offline', () => {
    mockState = 'offline';
    render(<ConnectionStatus />);
    expect(screen.getByText('Offline — using cached data')).toBeInTheDocument();
  });

  it('uses red background color for offline state', () => {
    mockState = 'offline';
    render(<ConnectionStatus />);
    const banner = screen.getByText('Offline — using cached data');
    expect(banner.style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  // ── Connecting State ──

  it('shows connecting banner when state is connecting', () => {
    mockState = 'connecting';
    render(<ConnectionStatus />);
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('uses signal red background color for connecting state', () => {
    mockState = 'connecting';
    render(<ConnectionStatus />);
    const banner = screen.getByText('Connecting...');
    expect(banner.style.backgroundColor).toBe('rgb(225, 29, 72)');
  });

  // ── Reconnecting State ──

  it('shows reconnecting banner when state is reconnecting', () => {
    mockState = 'reconnecting';
    render(<ConnectionStatus />);
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
  });

  it('uses signal red background color for reconnecting state', () => {
    mockState = 'reconnecting';
    render(<ConnectionStatus />);
    const banner = screen.getByText('Reconnecting...');
    expect(banner.style.backgroundColor).toBe('rgb(225, 29, 72)');
  });

  // ── State Transitions ──

  it('updates display when connection state changes from online to offline', () => {
    mockState = 'online';
    const { container } = render(<ConnectionStatus />);
    expect(container.querySelector('.connection-status')).toBeNull();

    // Simulate state change
    act(() => {
      registeredListener?.('offline');
    });
    expect(screen.getByText('Offline — using cached data')).toBeInTheDocument();
  });

  it('hides banner when connection state changes to online', () => {
    mockState = 'offline';
    render(<ConnectionStatus />);
    expect(screen.getByText('Offline — using cached data')).toBeInTheDocument();

    act(() => {
      registeredListener?.('online');
    });
    expect(screen.queryByText('Offline — using cached data')).not.toBeInTheDocument();
  });

  it('transitions from connecting to reconnecting', () => {
    mockState = 'connecting';
    render(<ConnectionStatus />);
    expect(screen.getByText('Connecting...')).toBeInTheDocument();

    act(() => {
      registeredListener?.('reconnecting');
    });
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
  });

  // ── Cleanup ──

  it('unsubscribes from state changes on unmount', () => {
    mockState = 'connecting';
    const { unmount } = render(<ConnectionStatus />);
    expect(registeredListener).not.toBeNull();

    unmount();
    expect(registeredListener).toBeNull();
  });
});
