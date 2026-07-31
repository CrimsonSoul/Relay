import React from 'react';
import { RADAR_STATUS_LABELS, TabName, type PublicRelayConfig } from '@shared/ipc';
import type { DynatraceDashboardState } from '@shared/dynatrace';
import { SidebarButton, type SidebarButtonStatus } from './sidebar/SidebarButton';
import { SidebarClientStatus } from './sidebar/SidebarClientStatus';
import { SidebarDashboards } from './sidebar/SidebarDashboards';
import { SidebarPresence } from './SidebarPresence';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import {
  ComposeIcon,
  AlertsIcon,
  PersonnelIcon,
  KnowledgeIcon,
  StatusIcon,
  ProblemsIcon,
  RadarIcon,
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
  relayConfig?: PublicRelayConfig | null;
  onClientConnected?: (hostname: string) => void;
  dynatraceDashboards?: DynatraceDashboardState[];
  onOpenDynatraceDashboard?: (id: string) => void | Promise<unknown>;
}

// Moved outside component to avoid recreation every render
const navItems: { label: string; tab: TabName; icon: React.ReactNode }[] = [
  { label: 'Compose', tab: 'Compose', icon: <ComposeIcon /> },
  { label: 'Alerts', tab: 'Alerts', icon: <AlertsIcon /> },
  { label: 'On-Call', tab: 'Personnel', icon: <PersonnelIcon /> },
  { label: 'Knowledge', tab: 'Knowledge', icon: <KnowledgeIcon /> },
  { label: 'Status', tab: 'Status', icon: <StatusIcon /> },
  { label: 'Problems', tab: 'Problems', icon: <ProblemsIcon /> },
  { label: 'Radar', tab: 'Radar', icon: <RadarIcon /> },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  clientPresence,
  relayMode,
  relayConfig,
  onClientConnected,
  dynatraceDashboards = [],
  onOpenDynatraceDashboard = () => undefined,
}) => {
  const showClientPresence = relayMode !== 'client';

  // The sidebar subscribes rather than the tab, so the button stays live even
  // when the Radar tab has never been opened.
  const { snapshot: radar } = useRadarSnapshot();
  const radarUnavailable = radar.lastUpdated === 0;
  const radarStale = !radarUnavailable && (radar.signInRequired || Boolean(radar.error));
  const radarTone = radarUnavailable || radarStale ? 'unknown' : radar.color;
  let radarLabel = RADAR_STATUS_LABELS[radar.color];
  if (radarUnavailable) radarLabel = 'Unknown';
  else if (radarStale) radarLabel = 'Stale';
  const hasRadarCounts = radar.xcenter.ok !== null || radar.xcenter.pending !== null;
  const radarStatus: SidebarButtonStatus = {
    tone: radarTone,
    announcement: hasRadarCounts
      ? `${radarLabel}. XCenter OK ${radar.xcenter.ok?.toLocaleString('en-US') ?? 'unknown'}, Pending ${radar.xcenter.pending?.toLocaleString('en-US') ?? 'unknown'}`
      : radarLabel,
  };

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
            status={item.tab === 'Radar' ? radarStatus : null}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        {clientPresence ? (
          showClientPresence && (
            <SidebarClientStatus
              count={clientPresence.count}
              hostnames={clientPresence.hostnames}
            />
          )
        ) : (
          <SidebarPresence relayConfig={relayConfig} onClientConnected={onClientConnected} />
        )}
        <SidebarDashboards
          dashboards={dynatraceDashboards}
          onOpenDashboard={onOpenDynatraceDashboard}
        />
        <SidebarButton
          label="Settings"
          isActive={activeTab === 'Settings'}
          onClick={onOpenSettings}
          icon={<SettingsIcon />}
        />
      </div>
    </div>
  );
};
