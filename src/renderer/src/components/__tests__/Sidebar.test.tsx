import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { Sidebar } from '../Sidebar';

// Mock SidebarButton to a simple button that captures props
vi.mock('../sidebar/SidebarButton', () => ({
  SidebarButton: ({
    label,
    isActive,
    onClick,
  }: {
    label: string;
    isActive: boolean;
    onClick: () => void;
  }) => (
    <button
      data-testid={`sidebar-btn-${label.toLowerCase()}`}
      data-active={isActive}
      onClick={onClick}
    >
      {label}
    </button>
  ),
}));

// Mock sidebar icons to simple spans
vi.mock('../sidebar/SidebarIcons', () => ({
  ComposeIcon: () => <span>ComposeIcon</span>,
  ClientsIcon: () => <span>ClientsIcon</span>,
  AlertsIcon: () => <span>AlertsIcon</span>,
  PersonnelIcon: () => <span>PersonnelIcon</span>,
  PeopleIcon: () => <span>PeopleIcon</span>,
  ServersIcon: () => <span>ServersIcon</span>,
  NotesIcon: () => <span>NotesIcon</span>,
  StatusIcon: () => <span>StatusIcon</span>,
  DashboardsIcon: () => <span>DashboardsIcon</span>,
  SettingsIcon: () => <span>SettingsIcon</span>,
  AppIcon: () => <span>AppIcon</span>,
}));

describe('Sidebar', () => {
  const defaultProps = {
    activeTab: 'Compose' as const,
    onTabChange: vi.fn(),
    onOpenSettings: vi.fn(),
    clientPresence: { count: 0, hostnames: [] },
  };

  it('renders all navigation items', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId('sidebar-btn-compose')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-alerts')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-on-call')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-notes')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-status')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-people')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-servers')).toBeInTheDocument();
  });

  it('renders Settings button', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId('sidebar-btn-settings')).toBeInTheDocument();
  });

  it('renders client presence above Settings in the sidebar footer', () => {
    const { container } = render(
      <Sidebar
        {...defaultProps}
        relayMode="server"
        clientPresence={{ count: 2, hostnames: ['ops-laptop', 'war-room-mac'] }}
      />,
    );

    expect(screen.getByTestId('sidebar-clients')).toHaveTextContent('2 clients');
    const footer = container.querySelector('.sidebar-footer');
    const clientBlock = screen.getByTestId('sidebar-clients');
    const settingsButton = screen.getByTestId('sidebar-btn-settings');
    expect(footer).toContainElement(clientBlock);
    expect(footer).toContainElement(settingsButton);
    expect(
      clientBlock.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders dashboard launcher between client presence and Settings when dashboards exist', () => {
    const { container } = render(
      <Sidebar
        {...defaultProps}
        relayMode="server"
        clientPresence={{ count: 1, hostnames: ['ops-laptop'] }}
        dynatraceDashboards={[
          {
            id: 'dt_1',
            name: 'NOC',
            url: 'https://abc.live.dynatrace.com/dashboard',
            state: 'live',
          },
        ]}
        onOpenDynatraceDashboard={vi.fn()}
      />,
    );

    const footer = container.querySelector('.sidebar-footer');
    const clientBlock = screen.getByTestId('sidebar-clients');
    const dashboardButton = screen.getByRole('button', {
      name: 'Open Dynatrace dashboard NOC',
    });
    const settingsButton = screen.getByTestId('sidebar-btn-settings');

    expect(footer).toContainElement(clientBlock);
    expect(footer).toContainElement(dashboardButton);
    expect(footer).toContainElement(settingsButton);
    expect(
      clientBlock.compareDocumentPosition(dashboardButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dashboardButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides client presence when Relay is running in client mode', () => {
    render(
      <Sidebar
        {...defaultProps}
        relayMode="client"
        clientPresence={{ count: 2, hostnames: ['ops-laptop', 'war-room-mac'] }}
      />,
    );

    expect(screen.queryByTestId('sidebar-clients')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-settings')).toBeInTheDocument();
  });

  it('marks the active tab as active', () => {
    render(<Sidebar {...defaultProps} activeTab="Alerts" />);

    expect(screen.getByTestId('sidebar-btn-alerts').dataset.active).toBe('true');
    expect(screen.getByTestId('sidebar-btn-compose').dataset.active).toBe('false');
  });

  it('calls onTabChange when a nav item is clicked', () => {
    const onTabChange = vi.fn();
    render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('sidebar-btn-alerts'));
    expect(onTabChange).toHaveBeenCalledWith('Alerts');
  });

  it('calls onOpenSettings when Settings is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<Sidebar {...defaultProps} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTestId('sidebar-btn-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onTabChange with Compose when app icon is clicked', () => {
    const onTabChange = vi.fn();
    render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    const appIcon = screen.getByLabelText('Go to Compose tab');
    fireEvent.click(appIcon);
    expect(onTabChange).toHaveBeenCalledWith('Compose');
  });

  it('renders app branding with Relay label', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Relay')).toBeInTheDocument();
  });

  it('renders sidebar structure with nav and footer', () => {
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(container.querySelector('.sidebar')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-nav')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-footer')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-divider')).toBeInTheDocument();
  });
});
