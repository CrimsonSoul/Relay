import React from 'react';
import { SidebarButton } from './sidebar/SidebarButton';
import {
  ComposeIcon,
  PersonnelIcon,
  AIIcon,
  PeopleIcon,
  ServersIcon,
  RadarIcon,
  WeatherIcon,
  SettingsIcon,
  AppIcon,
} from './sidebar/SidebarIcons';

type Tab = 'Compose' | 'Personnel' | 'People' | 'Radar' | 'Servers' | 'Weather' | 'AI';

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenSettings: () => void;
}

// Moved outside component to avoid recreation every render
const navItems: { label: string; tab: Tab; icon: React.ReactNode }[] = [
  { label: 'Compose', tab: 'Compose', icon: <ComposeIcon /> },
  { label: 'On-Call', tab: 'Personnel', icon: <PersonnelIcon /> },
  { label: 'AI Chat', tab: 'AI', icon: <AIIcon /> },
  { label: 'People', tab: 'People', icon: <PeopleIcon /> },
  { label: 'Servers', tab: 'Servers', icon: <ServersIcon /> },
  { label: 'Radar', tab: 'Radar', icon: <RadarIcon /> },
  { label: 'Weather', tab: 'Weather', icon: <WeatherIcon /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenSettings }) => {
  return (
    <div className="sidebar">
      {/* App Icon / Branding Block */}
      <div
        onClick={() => onTabChange('Compose')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTabChange('Compose');
          }
        }}
        id="app-icon-container"
        className="sidebar-app-icon interactive"
        role="button"
        tabIndex={0}
        aria-label="Go to Compose tab"
      >
        <div id="app-icon-inner" className="sidebar-app-icon-inner">
          <AppIcon />
        </div>
        <span className="sidebar-app-icon-label">Relay</span>
      </div>

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
