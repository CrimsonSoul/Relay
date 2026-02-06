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
  { label: 'On-Call Board', tab: 'Personnel', icon: <PersonnelIcon /> },
  { label: 'AI Chat', tab: 'AI', icon: <AIIcon /> },
  { label: 'People', tab: 'People', icon: <PeopleIcon /> },
  { label: 'Servers', tab: 'Servers', icon: <ServersIcon /> },
  { label: 'Radar', tab: 'Radar', icon: <RadarIcon /> },
  { label: 'Weather', tab: 'Weather', icon: <WeatherIcon /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenSettings }) => {
  const isDarwin = window.api?.platform === 'darwin';

  return (
    <div
      style={{
        width: '80px',
        background: 'var(--color-bg-chrome)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: isDarwin ? '54px' : '20px',
        paddingBottom: '24px',
        gap: '14px',
        zIndex: 9002,
        WebkitAppRegion: 'drag',
      }}
    >
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
      </div>

      <div
        style={{
          width: '36px',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)',
          marginBottom: '8px',
          flexShrink: 0,
        }}
      />

      <nav
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          WebkitAppRegion: 'no-drag',
        }}
      >
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

      <div
        style={{
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
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
