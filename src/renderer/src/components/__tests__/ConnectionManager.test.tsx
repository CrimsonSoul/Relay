import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';

// ---------------------------------------------------------------------------
// Mock usePocketBase hook
// ---------------------------------------------------------------------------

let mockConnectionState: string = 'connecting';
const mockUsePocketBase = vi.fn();

vi.mock('../../hooks/usePocketBase', () => ({
  usePocketBase: (pbUrl: string, pbAuth: unknown) => {
    mockUsePocketBase(pbUrl, pbAuth);
    return {
      connectionState: mockConnectionState,
    };
  },
}));

// Mock TactileButton
vi.mock('../TactileButton', () => ({
  TactileButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { ConnectionManager } from '../ConnectionManager';

describe('ConnectionManager', () => {
  const defaultProps = {
    pbUrl: 'http://localhost:8090',
    pbAuth: { token: 'test-token', record: null },
    onReconfigure: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionState = 'connecting';
    globalThis.api = {
      runtime: ELECTRON_RUNTIME,
      windowClose: vi.fn(),
    } as never;
  });

  // ── Connecting State ──

  it('shows spinner and connecting message when connectionState is connecting', () => {
    mockConnectionState = 'connecting';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );
    expect(screen.getByText('Connecting to server...')).toBeInTheDocument();
    expect(screen.queryByText('child-content')).not.toBeInTheDocument();
  });

  it('passes pbAuth to usePocketBase', () => {
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );

    expect(mockUsePocketBase).toHaveBeenCalledWith(defaultProps.pbUrl, defaultProps.pbAuth);
  });

  it('renders a close button in connecting state', () => {
    mockConnectionState = 'connecting';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child</div>
      </ConnectionManager>,
    );
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('renders a Reconfigure button in connecting state', () => {
    mockConnectionState = 'connecting';
    const onReconfigure = vi.fn();
    render(
      <ConnectionManager {...defaultProps} onReconfigure={onReconfigure}>
        <div>child</div>
      </ConnectionManager>,
    );
    const btn = screen.getByText('Reconfigure');
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onReconfigure).toHaveBeenCalledTimes(1);
  });

  // ── Connected State ──

  it('renders children when connected (online)', () => {
    mockConnectionState = 'online';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
    expect(screen.queryByText('Connecting to server...')).not.toBeInTheDocument();
  });

  it('does not render the floating connection banner alongside children', () => {
    mockConnectionState = 'online';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument();
    expect(document.querySelector('.connection-status')).not.toBeInTheDocument();
  });

  it('renders children when in offline state (non-error, non-connecting)', () => {
    mockConnectionState = 'offline';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });

  it('renders children when in reconnecting state', () => {
    mockConnectionState = 'reconnecting';
    render(
      <ConnectionManager {...defaultProps}>
        <div>child-content</div>
      </ConnectionManager>,
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });

  it('keeps browser work mounted under an in-place session-expired overlay', async () => {
    mockConnectionState = 'auth-failed';
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    const onWebReauthenticate = vi.fn(async () => true);
    render(
      <ConnectionManager
        {...defaultProps}
        onWebReauthenticate={onWebReauthenticate}
        onWebSessionRequired={vi.fn()}
      >
        <input aria-label="Unsaved work" defaultValue="Draft" />
      </ConnectionManager>,
    );

    expect(screen.getByLabelText('Unsaved work')).toHaveValue('Draft');
    fireEvent.change(screen.getByLabelText('Connection passphrase'), {
      target: { value: 'correct-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    });
    expect(onWebReauthenticate).toHaveBeenCalledWith('correct-value');
    expect(screen.getByLabelText('Unsaved work')).toHaveValue('Draft');
  });
});
