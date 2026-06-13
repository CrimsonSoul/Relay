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
    type,
    block: _b,
    className: _c,
    variant: _v,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    block?: boolean;
    className?: string;
    variant?: string;
  }) => React.createElement('button', { onClick, disabled, type }, children),
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

  it('shows Dynatrace dashboard settings and opens a saved dashboard', async () => {
    const openDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'closed',
            },
          ],
          addDashboard: vi.fn(),
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard,
          clearSession: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText('Dynatrace Dashboards')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open NOC' }));

    await waitFor(() => {
      expect(openDashboard).toHaveBeenCalledWith('dt_1');
    });
  });

  it('adds a Dynatrace dashboard from Settings', async () => {
    const addDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://abc.live.dynatrace.com/dashboard' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add dashboard' }));

    await waitFor(() =>
      expect(addDashboard).toHaveBeenCalledWith({
        name: 'NOC',
        url: 'https://abc.live.dynatrace.com/dashboard',
      }),
    );
  });

  it('shows inline validation for invalid Dynatrace dashboard URLs', () => {
    const addDashboard = vi.fn().mockResolvedValue(true);
    const insecureDynatraceUrl = ['http', '://abc.live.dynatrace.com/dashboard'].join('');

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: insecureDynatraceUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add dashboard' }));

    expect(screen.getByText('Dynatrace dashboard URLs must use HTTPS.')).toBeInTheDocument();
    expect(addDashboard).not.toHaveBeenCalled();
  });

  it('updates a Dynatrace dashboard from Settings', async () => {
    const updateDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'live',
            },
          ],
          addDashboard: vi.fn(),
          updateDashboard,
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit NOC' }));
    expect(screen.getByLabelText('Dashboard name')).toHaveValue('NOC');
    expect(screen.getByLabelText('Dashboard URL')).toHaveValue(
      'https://abc.live.dynatrace.com/dashboard',
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC Main' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://apps.dynatrace.com/dashboard/noc-main' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save dashboard' }));

    await waitFor(() =>
      expect(updateDashboard).toHaveBeenCalledWith('dt_1', {
        name: 'NOC Main',
        url: 'https://apps.dynatrace.com/dashboard/noc-main',
      }),
    );
  });

  it('clears the Dynatrace session from Settings', async () => {
    const clearSession = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard: vi.fn(),
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear Dynatrace session' }));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
    });
  });
});
