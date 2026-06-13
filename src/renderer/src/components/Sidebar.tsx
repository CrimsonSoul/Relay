import React from 'react';
import { TabName, type PublicRelayConfig } from '@shared/ipc';
import type { DynatraceDashboardState } from '@shared/dynatrace';
import { SidebarButton } from './sidebar/SidebarButton';
import { SidebarClientStatus } from './sidebar/SidebarClientStatus';
import { SidebarDashboards } from './sidebar/SidebarDashboards';
import {
  ComposeIcon,
  AlertsIcon,
  PersonnelIcon,
  PeopleIcon,
  ServersIcon,
  NotesIcon,
  StatusIcon,
  SettingsIcon,
} from './sidebar/SidebarIcons';

interface SidebarProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  onOpenSettings: () => void;
  clientPresence?: {
    count: number;
    hostnames: string[];
  };
  relayMode?: PublicRelayConfig['mode'];
  dynatraceDashboards?: DynatraceDashboardState[];
  onOpenDynatraceDashboard?: (id: string) => void | Promise<void>;
}

// Moved outside component to avoid recreation every render
const navItems: { label: string; tab: TabName; icon: React.ReactNode }[] = [
  { label: 'Compose', tab: 'Compose', icon: <ComposeIcon /> },
  { label: 'Alerts', tab: 'Alerts', icon: <AlertsIcon /> },
  { label: 'On-Call', tab: 'Personnel', icon: <PersonnelIcon /> },
  { label: 'Notes', tab: 'Notes', icon: <NotesIcon /> },
  { label: 'Status', tab: 'Status', icon: <StatusIcon /> },
  { label: 'People', tab: 'People', icon: <PeopleIcon /> },
  { label: 'Servers', tab: 'Servers', icon: <ServersIcon /> },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  clientPresence = { count: 0, hostnames: [] },
  relayMode,
  dynatraceDashboards = [],
  onOpenDynatraceDashboard = () => undefined,
}) => {
  const showClientPresence = relayMode !== 'client';

  return (
    <div className="sidebar">
      {/* App Icon / Branding Block */}
      <button
        type="button"
        onClick={() => onTabChange('Compose')}
        id="app-icon-container"
        className="sidebar-app-icon interactive"
        aria-label="Go to Compose tab"
      >
        <span className="sidebar-app-icon-label">Relay</span>
      </button>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <SidebarButton
            key={item.tab}
            label={item.label}
            isActive={activeTab === item.tab}
            onClick={() => onTabChange(item.tab)}
            icon={item.icon}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        {showClientPresence && (
          <SidebarClientStatus count={clientPresence.count} hostnames={clientPresence.hostnames} />
        )}
        <SidebarDashboards
          dashboards={dynatraceDashboards}
          onOpenDashboard={onOpenDynatraceDashboard}
        />
        <SidebarButton
          label="Settings"
          isActive={false}
          onClick={onOpenSettings}
          icon={<SettingsIcon />}
        />
      </div>
    </div>
  );
};
