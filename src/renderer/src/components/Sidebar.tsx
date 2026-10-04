import React, { useMemo } from 'react';
import { TabName, type CloudStatusData, type OnCallRow, type PublicRelayConfig } from '@shared/ipc';
import type { DynatraceDashboardState } from '@shared/dynatrace';
import { SidebarButton, type SidebarButtonStatus } from './sidebar/SidebarButton';
import { SidebarClientStatus } from './sidebar/SidebarClientStatus';
import { SidebarDashboards } from './sidebar/SidebarDashboards';
import { SidebarPresence } from './SidebarPresence';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import {
  useUnaddressedProblemCount,
  type ProblemCountFreshness,
} from '../hooks/useUnaddressedProblemCount';
import {
  ComposeIcon,
  AlertsIcon,
  PersonnelIcon,
  KnowledgeIcon,
  StatusIcon,
  ProblemsIcon,
  RadarIcon,
  SettingsIcon,
  TicketsIcon,
} from './sidebar/SidebarIcons';
import { deriveRadarStatus } from '../tabs/radarStatus';
import { deriveCloudStatusSidebarStatus } from '../tabs/cloudStatusPosture';
import { getVacantOnCallTeams } from '../utils/onCallRoles';

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
  /** The app-wide Cloud Status snapshot (`useAppCloudStatus`), summarised on the Status item. */
  cloudStatusData?: CloudStatusData | null;
  /** The app-wide on-call rows (`useAppData`); a team with no coverage puts an alarm pip on On-Call. */
  onCall?: readonly OnCallRow[];
}

// The rail marks a stale count with a slashed ring; the announcement says why and what the count is.
const PROBLEM_COUNT_STALE_NOTE: Record<Exclude<ProblemCountFreshness, 'live'>, string> = {
  off: "Dynatrace sync is off — count is Relay's saved copy",
  failed: "Dynatrace sync failed — count is Relay's saved copy",
  stale: "Dynatrace sync retrying — count is Relay's saved copy",
};

/**
 * Problems says its count in the tab's own word, "Unaddressed", beside the warning diamond. Count
 * and noun share the one state line: "99+ unaddressed" is 110 px at the line's 14 px in the 112 px
 * content width (`.sidebar-button-state`).
 */
function problemsStatusFor(
  count: number | null,
  freshness: ProblemCountFreshness,
): SidebarButtonStatus | null {
  if (!count) return null;
  const unaddressed = `${count} unaddressed ${count === 1 ? 'problem' : 'problems'}`;
  const word = count > 99 ? '99+' : String(count);
  const shown = { tone: 'yellow', word, noun: 'unaddressed' };
  if (freshness === 'live') return { ...shown, announcement: unaddressed };
  return {
    ...shown,
    stale: true,
    announcement: `${unaddressed} · ${PROBLEM_COUNT_STALE_NOTE[freshness]}`,
  };
}

/** Coverage is the board's purpose, so a vacant team shows on the sidebar from every tab. */
function onCallStatusFor(onCall: readonly OnCallRow[]): SidebarButtonStatus | null {
  const vacant = getVacantOnCallTeams(onCall).length;
  if (vacant === 0) return null;
  return {
    tone: 'red',
    announcement: `${vacant} ${vacant === 1 ? 'team has' : 'teams have'} no coverage`,
    word: 'No coverage',
  };
}

/**
 * Visible state words for the alarm pips, keyed by tone (see `.sidebar-button-status-word` for the
 * 112 px state line). A failing Radar feed says the board's own headline ("Unavailable" before any
 * data has loaded, "Stale" while the last good board shows), so the sidebar and the Radar tab use
 * one word for one state. Radar and Status keep healthy, warning and waiting states pip-only.
 */
const RADAR_STATE_WORDS: Partial<Record<string, string>> = { red: 'Critical' };
const CLOUD_STATE_WORDS: Partial<Record<string, string>> = { red: 'Outage' };

function withStateWord(
  status: SidebarButtonStatus,
  words: Partial<Record<string, string>>,
): SidebarButtonStatus {
  const word = words[status.tone];
  return word ? { ...status, word } : status;
}

// Moved outside component to avoid recreation every render. Order matches the Cmd/Ctrl+1–8
// shortcuts in `useKeyboardShortcuts`.
const navItems: { label: string; tab: TabName; icon: React.ReactNode }[] = [
  { label: 'Compose', tab: 'Compose', icon: <ComposeIcon /> },
  { label: 'Alerts', tab: 'Alerts', icon: <AlertsIcon /> },
  { label: 'On-Call', tab: 'Personnel', icon: <PersonnelIcon /> },
  { label: 'Knowledge', tab: 'Knowledge', icon: <KnowledgeIcon /> },
  { label: 'Status', tab: 'Status', icon: <StatusIcon /> },
  { label: 'Problems', tab: 'Problems', icon: <ProblemsIcon /> },
  { label: 'Radar', tab: 'Radar', icon: <RadarIcon /> },
  { label: 'Tickets', tab: 'Tickets', icon: <TicketsIcon /> },
];

const EMPTY_ON_CALL: readonly OnCallRow[] = [];

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
  cloudStatusData = null,
  onCall = EMPTY_ON_CALL,
}) => {
  const showClientPresence = relayMode !== 'client';

  // The sidebar subscribes rather than the tab, so the button stays live even
  // when the Radar tab has never been opened.
  const { snapshot: radar } = useRadarSnapshot();
  const {
    state: radarState,
    tone: radarTone,
    label: radarLabel,
    description: radarDescription,
  } = deriveRadarStatus(radar);
  // A live board speaks its one-word health; anything else explains itself.
  const radarSummary = radarState === 'live' ? radarLabel : radarDescription;
  const hasRadarCounts = radar.xcenter.ok !== null || radar.xcenter.pending !== null;
  const radarStatus = withStateWord(
    {
      tone: radarTone,
      announcement: hasRadarCounts
        ? `${radarSummary}. XCenter OK ${radar.xcenter.ok?.toLocaleString('en-US') ?? 'unknown'}, Pending ${radar.xcenter.pending?.toLocaleString('en-US') ?? 'unknown'}`
        : radarSummary,
    },
    { ...RADAR_STATE_WORDS, failed: radarLabel },
  );
  const { count: unaddressedProblems, freshness: problemFreshness } = useUnaddressedProblemCount();
  const problemsStatus = problemsStatusFor(unaddressedProblems, problemFreshness);
  // Reads the snapshot App already subscribes to; the sidebar adds no subscription of its own.
  const cloudStatus: SidebarButtonStatus = useMemo(
    () => withStateWord(deriveCloudStatusSidebarStatus(cloudStatusData), CLOUD_STATE_WORDS),
    [cloudStatusData],
  );
  // Same rule as the board's "No coverage", over the rows App already holds; no new subscription.
  const onCallStatus = useMemo(() => onCallStatusFor(onCall), [onCall]);
  const statusFor = (tab: TabName): SidebarButtonStatus | null => {
    if (tab === 'Status') return cloudStatus;
    if (tab === 'Radar') return radarStatus;
    if (tab === 'Problems') return problemsStatus;
    if (tab === 'Personnel') return onCallStatus;
    return null;
  };

  return (
    <div className="sidebar-shell">
      <aside className="sidebar" aria-label="Relay navigation">
        {/* App Icon / Branding Block */}
        <button
          type="button"
          onClick={() => onTabChange('Compose')}
          id="app-icon-container"
          className="sidebar-app-icon interactive"
          aria-label="Relay, go to Compose"
        >
          <span className="sidebar-app-icon-label">Relay</span>
        </button>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {navItems.map((item, index) => (
            <SidebarButton
              key={item.tab}
              label={item.label}
              isActive={activeTab === item.tab}
              onClick={() => onTabChange(item.tab)}
              icon={item.icon}
              status={statusFor(item.tab)}
              shortcutKey={String(index + 1)}
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
            shortcutKey=","
          />
        </div>
      </aside>
    </div>
  );
};
