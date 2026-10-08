import React, { useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TabName, type CloudStatusData, type OnCallRow, type PublicRelayConfig } from '@shared/ipc';
import type { DynatraceDashboardState } from '@shared/dynatrace';
import { SidebarButton, type SidebarButtonStatus } from './sidebar/SidebarButton';
import { SidebarClientStatus } from './sidebar/SidebarClientStatus';
import { SidebarDashboards } from './sidebar/SidebarDashboards';
import { SidebarPresence } from './SidebarPresence';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import {
  moveSidebarTab,
  saveSidebarOrder,
  SIDEBAR_TABS,
  useSidebarOrder,
  type SidebarTab,
} from './sidebar/sidebarOrder';
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

// Moved outside component to avoid recreation every render. The person's saved order
// (`sidebarOrder`) arranges them, and the Cmd/Ctrl+1–8 shortcuts follow it.
const navItems: Record<SidebarTab, { label: string; icon: React.ReactNode }> = {
  Compose: { label: 'Compose', icon: <ComposeIcon /> },
  Alerts: { label: 'Alerts', icon: <AlertsIcon /> },
  Personnel: { label: 'On-Call', icon: <PersonnelIcon /> },
  Knowledge: { label: 'Knowledge', icon: <KnowledgeIcon /> },
  Status: { label: 'Status', icon: <StatusIcon /> },
  Problems: { label: 'Problems', icon: <ProblemsIcon /> },
  Radar: { label: 'Radar', icon: <RadarIcon /> },
  Tickets: { label: 'Tickets', icon: <TicketsIcon /> },
};
const labelOf = (id: UniqueIdentifier) => navItems[id as SidebarTab]?.label ?? String(id);
const isMenuKey = (event: React.KeyboardEvent) =>
  event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

/** A destination dragged into a new place; it moves only up and down the rail. */
function SortableSidebarItem({
  tab,
  children,
}: Readonly<{ tab: SidebarTab; children: React.ReactNode }>) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab });
  // Only the pointer drags; the button keeps Enter and Space, and Alt+Arrow keys move it.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-sidebar-tab={tab}
      className={`sidebar-sortable${isDragging ? ' sidebar-sortable--dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
    >
      {children}
    </div>
  );
}

const EMPTY_ON_CALL: readonly OnCallRow[] = [];

/**
 * Reordering the destinations: drag one along the rail, press Alt+Up or Alt+Down on it, or use its
 * context menu (right-click or Shift+F10). The order is saved on this device and announced.
 */
function useSidebarReorder(order: readonly SidebarTab[]) {
  const nav = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; tab: SidebarTab }>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const position = (tab: SidebarTab, list: readonly SidebarTab[]) =>
    `position ${list.indexOf(tab) + 1} of ${list.length}`;
  function save(next: SidebarTab[], tab: SidebarTab, focus: boolean) {
    if (next.every((item, index) => item === order[index])) return;
    saveSidebarOrder(next);
    setAnnouncement(`${navItems[tab].label} moved to ${position(tab, next)}.`);
    // Reordering moves the button's DOM node, which can drop its focus.
    if (focus)
      requestAnimationFrame(() =>
        nav.current
          ?.querySelector<HTMLButtonElement>(`[data-sidebar-tab="${tab}"] button`)
          ?.focus(),
      );
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} is over ${position(over.id as SidebarTab, order)}.`
        : `${labelOf(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} dropped at ${position(over.id as SidebarTab, order)}.`
        : `${labelOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} was cancelled.`,
  };
  // The click that ends a drag must not also open the dragged destination.
  const settle = () =>
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  return {
    nav,
    dragging,
    sensors,
    announcements,
    announcement,
    menu,
    dragStart: () => {
      dragging.current = true;
    },
    dragEnd: ({
      active,
      over,
    }: {
      active: { id: UniqueIdentifier };
      over: { id: UniqueIdentifier } | null;
    }) => {
      const tab = active.id as SidebarTab;
      if (over)
        save(
          moveSidebarTab(order, tab, order.indexOf(over.id as SidebarTab) - order.indexOf(tab)),
          tab,
          false,
        );
      settle();
    },
    dragCancel: settle,
    keyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: SidebarTab) {
      if (isMenuKey(event)) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.right, y: rect.top, tab });
      } else if (
        event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        save(moveSidebarTab(order, tab, event.key === 'ArrowUp' ? -1 : 1), tab, true);
      }
    },
    openMenu: (x: number, y: number, tab: SidebarTab) => setMenu({ x, y, tab }),
    closeMenu: () => setMenu(undefined),
    menuItems: (tab: SidebarTab): ContextMenuItem[] => [
      {
        label: 'Move Up',
        disabled: order[0] === tab,
        onClick: () => save(moveSidebarTab(order, tab, -1), tab, true),
      },
      {
        label: 'Move Down',
        disabled: order.at(-1) === tab,
        onClick: () => save(moveSidebarTab(order, tab, 1), tab, true),
      },
      {
        label: 'Reset Sidebar Order',
        disabled: order.every((item, index) => item === SIDEBAR_TABS[index]),
        onClick: () => save([...SIDEBAR_TABS], tab, true),
      },
    ],
  };
}

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
  const order = useSidebarOrder();
  const reorder = useSidebarReorder(order);
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

        <nav className="sidebar-nav" ref={reorder.nav}>
          <DndContext
            id="sidebar-order-dnd"
            sensors={reorder.sensors}
            collisionDetection={closestCenter}
            accessibility={{ announcements: reorder.announcements }}
            onDragStart={reorder.dragStart}
            onDragEnd={reorder.dragEnd}
            onDragCancel={reorder.dragCancel}
          >
            <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
              {order.map((tab, index) => (
                <SortableSidebarItem key={tab} tab={tab}>
                  <SidebarButton
                    label={navItems[tab].label}
                    isActive={activeTab === tab}
                    onClick={() => {
                      if (!reorder.dragging.current) onTabChange(tab);
                    }}
                    onKeyDown={(event) => reorder.keyDown(event, tab)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      reorder.openMenu(event.clientX, event.clientY, tab);
                    }}
                    icon={navItems[tab].icon}
                    status={statusFor(tab)}
                    shortcutKey={String(index + 1)}
                  />
                </SortableSidebarItem>
              ))}
            </SortableContext>
          </DndContext>
        </nav>
        <p className="sr-only" aria-live="polite">
          {reorder.announcement}
        </p>
        {reorder.menu && (
          <ContextMenu
            x={reorder.menu.x}
            y={reorder.menu.y}
            items={reorder.menuItems(reorder.menu.tab)}
            onClose={reorder.closeMenu}
          />
        )}

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
