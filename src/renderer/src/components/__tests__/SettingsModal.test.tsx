import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from '../SettingsModal';

// Mock Modal to a simple wrapper
vi.mock('../Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen
      ? React.createElement(
          'div',
          { role: 'dialog' },
          title && React.createElement('h2', null, title),
          children,
        )
      : null,
}));

// Mock TactileButton
vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    disabled,
    block: _b,
    className: _c,
    variant: _v,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    block?: boolean;
    className?: string;
    variant?: string;
  }) => React.createElement('button', { onClick, disabled }, children),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};
const LAN_SERVER_ADDRESS = ['192', '168', '1', '25'].join('.');
const CONNECTION_SECRET = ['fixture', 'passphrase', '123'].join('-');

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockApi = {
      getConfig: vi.fn().mockResolvedValue({
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        lanIp: LAN_SERVER_ADDRESS,
      }),
      getConnectionSecret: vi.fn().mockResolvedValue(CONNECTION_SECRET),
      clearConfig: vi.fn().mockResolvedValue(true),
    };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;
  });

  it('renders nothing when closed', () => {
    render(<SettingsModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when open', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows "Open Data Manager..." when onOpenDataManager is provided', () => {
    const onOpenDataManager = vi.fn();
    render(<SettingsModal {...defaultProps} onOpenDataManager={onOpenDataManager} />);
    expect(screen.getByText('Open Data Manager...')).toBeInTheDocument();
  });

  it('calls onClose and onOpenDataManager when "Open Data Manager..." is clicked', () => {
    const onClose = vi.fn();
    const onOpenDataManager = vi.fn();
    render(
      <SettingsModal {...defaultProps} onClose={onClose} onOpenDataManager={onOpenDataManager} />,
    );
    fireEvent.click(screen.getByText('Open Data Manager...'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenDataManager).toHaveBeenCalled();
  });

  it('does not show Data Manager button when onOpenDataManager is not provided', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.queryByText('Open Data Manager...')).not.toBeInTheDocument();
  });

  it('shows PocketBase section with connection info', async () => {
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Embedded Server/)).toBeInTheDocument();
      expect(screen.getByText(`URL: http://${LAN_SERVER_ADDRESS}:8090`)).toBeInTheDocument();
      expect(screen.queryByText(/IP:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Port:/)).not.toBeInTheDocument();
    });
  });

  it('shows the connection passphrase masked until revealed', async () => {
    render(<SettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Passphrase:/)).toHaveTextContent(
        'Passphrase: ••••••••••••••••••••••',
      );
    });
    expect(screen.queryByText(CONNECTION_SECRET)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));

    expect(screen.getByText(`Passphrase: ${CONNECTION_SECRET}`)).toBeInTheDocument();
  });

  it('shows Reconfigure button', async () => {
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure...')).toBeInTheDocument();
    });
  });

  it('shows "Not configured" when getConfig returns null', async () => {
    (globalThis.api as Record<string, unknown>).getConfig = vi.fn().mockResolvedValue(null);
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });
  });

  it('calls clearConfig and onReconfigure when Reconfigure is clicked', async () => {
    const onClose = vi.fn();
    const onReconfigure = vi.fn();
    render(<SettingsModal {...defaultProps} onClose={onClose} onReconfigure={onReconfigure} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure...')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Reconfigure...'));
    await waitFor(() => {
      expect(globalThis.api.clearConfig).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onReconfigure).toHaveBeenCalled();
    });
  });
});
