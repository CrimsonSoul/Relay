import React from 'react';
import { TabName } from '@shared/ipc';
import { SidebarButton } from './sidebar/SidebarButton';
import {
  ComposeIcon,
  AlertsIcon,
  PersonnelIcon,
  PeopleIcon,
  ServersIcon,
  RadarIcon,
  WeatherIcon,
  NotesIcon,
  StatusIcon,
  SettingsIcon,
  AppIcon,
} from './sidebar/SidebarIcons';

interface SidebarProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  onOpenSettings: () => void;
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
  { label: 'Radar', tab: 'Radar', icon: <RadarIcon /> },
  { label: 'Weather', tab: 'Weather', icon: <WeatherIcon /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenSettings }) => {
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
        <span id="app-icon-inner" className="sidebar-app-icon-inner">
          <AppIcon />
        </span>
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
