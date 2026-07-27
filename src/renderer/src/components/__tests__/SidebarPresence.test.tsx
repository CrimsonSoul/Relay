import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicRelayConfig } from '@shared/ipc';
import { SidebarPresence } from '../SidebarPresence';
import type { useClientPresence } from '../../hooks/useClientPresence';

// Typed against the real hook so the forwarded arguments the assertions inspect
// stay checked against its actual signature.
const mockUseClientPresence = vi.fn<typeof useClientPresence>(() => ({
  count: 2,
  hostnames: ['ops-laptop', 'war-room-mac'],
  clients: [],
  loading: false,
}));

vi.mock('../../hooks/useClientPresence', () => ({
  useClientPresence: (...args: Parameters<typeof useClientPresence>) =>
    mockUseClientPresence(...args),
}));

const serverConfig: PublicRelayConfig = {
  mode: 'server',
  port: 8090,
  bindHost: '0.0.0.0',
};

const clientConfig: PublicRelayConfig = {
  mode: 'client',
  serverUrl: ['http', '://relay.local:8090'].join(''),
};

describe('SidebarPresence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders active clients inside its own component boundary in server mode', () => {
    render(<SidebarPresence relayConfig={serverConfig} />);

    expect(screen.getByTestId('sidebar-clients')).toHaveTextContent('2 clients');
  });

  it('keeps the client heartbeat hook mounted without showing the server client list', () => {
    render(<SidebarPresence relayConfig={clientConfig} />);

    expect(mockUseClientPresence).toHaveBeenCalledWith(clientConfig, undefined);
    expect(screen.queryByTestId('sidebar-clients')).not.toBeInTheDocument();
  });
});
