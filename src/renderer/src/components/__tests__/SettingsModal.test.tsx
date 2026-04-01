import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from '../SettingsModal';

// Mock secureStorage
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn().mockReturnValue(''),
    setItemSync: vi.fn(),
  },
}));

// Mock RADAR_URL_KEY
vi.mock('../../tabs/RadarTab', () => ({
  RADAR_URL_KEY: 'radar_url',
}));

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

// Mock useToast
const showToast = vi.fn();
vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}));

import { secureStorage } from '../../utils/secureStorage';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockApi = {
      getConfig: vi.fn().mockResolvedValue({ mode: 'server', port: 8090, secret: 'test' }),
      registerRadarUrl: vi.fn().mockReturnValue(Promise.resolve()),
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
    });
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

  it('saves radar URL and shows success toast', async () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByPlaceholderText(
      'https://your-intranet/dashboard',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://radar.example.com' } });
    fireEvent.click(screen.getByText('Save'));

    expect(secureStorage.setItemSync).toHaveBeenCalledWith(
      'radar_url',
      'https://radar.example.com',
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Radar URL saved', 'success'));
  });

  it('shows error toast for invalid radar URL', () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByPlaceholderText('https://your-intranet/dashboard');
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByText('Save'));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('http'), 'error');
  });

  it('clears radar URL when Clear button is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(secureStorage.setItemSync).toHaveBeenCalledWith('radar_url', '');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Radar URL cleared', 'success'));
  });

  it('reads existing radar URL from secureStorage on open', () => {
    (secureStorage.getItemSync as ReturnType<typeof vi.fn>).mockReturnValue('https://existing.com');
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByPlaceholderText(
      'https://your-intranet/dashboard',
    ) as HTMLInputElement;
    expect(input.value).toBe('https://existing.com');
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
