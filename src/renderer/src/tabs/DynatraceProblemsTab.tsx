import { SdpProblemChanges } from '../features/tickets/SdpProblemChanges';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  buildDynatraceProblemUrl,
  dynatraceAnalystKey,
  getDynatraceNocSourceLabel,
  type DynatraceNocAnalyst,
  getDynatraceProblemDisplayTitle,
  type DynatraceEntityRef,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemRecord,
  type DynatraceProblemSeverity,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { normalizeServiceDeskUrl } from '@shared/urlSecurity';
import { SdpProblemTickets } from '../features/tickets/SdpRelationships';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { TactileButton } from '../components/TactileButton';
import { EmptyState } from '../components/EmptyState';
import { Tooltip } from '../components/Tooltip';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import { SearchInput } from '../components/SearchInput';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';
import { useDynatraceProblems } from '../hooks/useDynatraceProblems';
import { useDynatraceProblemShortcuts } from '../hooks/useDynatraceProblemShortcuts';
import { parseDynatraceTicketReferenceNote } from '../services/dynatraceProblemsService';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';
import {
  buildDynatraceProblemQueueModel,
  isProblemAddressed,
  PROBLEM_FILTERS,
  readHistoryPreferences,
  readQueueSort,
  writeHistoryPreferences,
  writeQueueSort,
  type HistoryPreferences,
  type HistoryResponseFilter,
  type HistorySort,
  type ProblemFilter,
  type ProblemResponseSummary,
  type QueueSort,
} from './dynatraceProblemQueueModel';
import {
  useProblemDispositionWorkflow,
  type ProblemSavingAction,
} from './useProblemDispositionWorkflow';
import { openSettingsSection } from '../components/settingsNavigation';
import { TabFreshness } from '../components/TabFreshness';
import { DynatraceProblemNoteBody } from './DynatraceProblemNoteBody';
import { describesMoreThan, leadingHeading, ProblemDescription } from './ProblemDescription';
import './dynatrace-problems.css';

function severityLabel(severity: DynatraceProblemSeverity): string {
  switch (severity) {
    case 'MONITORING_UNAVAILABLE':
      return 'Monitoring unavailable';
    case 'RESOURCE_CONTENTION':
      return 'Resource contention';
    case 'CUSTOM_ALERT':
      return 'Custom alert';
    default:
      return severity.charAt(0) + severity.slice(1).toLowerCase();
  }
}

function severityTone(severity: DynatraceProblemSeverity): 'critical' | 'warning' | 'info' {
  if (severity === 'INFO') return 'info';
  if (
    severity === 'AVAILABILITY' ||
    severity === 'MONITORING_UNAVAILABLE' ||
    severity === 'ERROR'
  ) {
    return 'critical';
  }
  return 'warning';
}

type DateTimeValue = number | string | undefined;

function formatDateTime(value: DateTimeValue): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatExactDateTime(value: DateTimeValue): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function toDateTimeAttribute(value: DateTimeValue): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getSafeTicketUrl(reference: string): string | null {
  return normalizeServiceDeskUrl(reference);
}

function timeAgo(value: string | undefined): string {
  if (!value) return 'Never';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(problem: DynatraceProblemRecord): string {
  const end = problem.status === 'OPEN' || problem.endTime < 0 ? Date.now() : problem.endTime;
  const durationMs = Math.max(0, end - problem.startTime);
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** When a resolved problem ended: the time today, otherwise the date. */
function formatResolvedTime(problem: DynatraceProblemRecord): string {
  if (problem.endTime <= 0) return formatDuration(problem);
  const end = new Date(problem.endTime);
  const today = new Date();
  return end.toDateString() === today.toDateString()
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getPrimaryEntity(problem: DynatraceProblemRecord): {
  kind: 'Root cause' | 'Host' | 'Entity';
  name: string;
  additionalCount: number;
} | null {
  const entities = [...problem.affectedEntities, ...problem.impactedEntities];
  const uniqueEntities = entities.filter(
    (entity, index) => entities.findIndex((candidate) => candidate.id === entity.id) === index,
  );
  const rootCause = problem.rootCauseName.trim();
  if (rootCause) {
    const additionalCount = uniqueEntities.filter((entity) => entity.name !== rootCause).length;
    return { kind: 'Root cause', name: rootCause, additionalCount };
  }

  const entity =
    uniqueEntities.find((candidate) => candidate.name !== candidate.id) ?? uniqueEntities[0];
  if (!entity) return null;
  return {
    kind: entity.type.toUpperCase().includes('HOST') ? 'Host' : 'Entity',
    name: entity.name,
    additionalCount: Math.max(0, uniqueEntities.length - 1),
  };
}

function EntityList({ entities }: Readonly<{ entities: DynatraceEntityRef[] }>) {
  if (entities.length === 0) return <span className="dt-problems__muted">None reported</span>;
  const visible = entities.slice(0, 8);
  return (
    <div className="dt-problems__entity-list">
      {visible.map((entity) => (
        <span className="dt-problems__entity" key={`${entity.type}:${entity.id}`}>
          <span>{entity.name}</span>
          <small>{entity.type.replaceAll('_', ' ')}</small>
        </span>
      ))}
      {entities.length > visible.length && (
        <span className="dt-problems__entity-more">+{entities.length - visible.length} more</span>
      )}
    </div>
  );
}

/** A History row's NOC response, shown only when there is one (the Response filter finds the rest). */
function ProblemResponseMetadata({
  summary,
}: Readonly<{ summary: ProblemResponseSummary | undefined }>) {
  if (!summary?.hasLocalResponse) return null;

  const hasResponder = Boolean(summary.responder);
  const hasNotes = summary.nocNoteCount > 0;
  const ticketReference = summary.ticketReferences[0];

  if (!hasResponder && !hasNotes && !ticketReference) {
    return <span className="dt-problem-row__local-response">Addressed</span>;
  }

  return (
    <span className="dt-problem-row__local-response">
      {hasResponder && (
        <strong className="dt-problem-row__response-author">{summary.responder}</strong>
      )}
      {hasNotes && (
        <span className="dt-problem-row__response-part">
          {hasResponder && (
            <span className="dt-problem-row__response-separator" aria-hidden="true">
              {' · '}
            </span>
          )}
          <span className="dt-problem-row__response-count">
            {summary.nocNoteCount} note{summary.nocNoteCount === 1 ? '' : 's'}
          </span>
        </span>
      )}
      {ticketReference && (
        <span className="dt-problem-row__response-part dt-problem-row__response-part--ticket">
          {(hasResponder || hasNotes) && (
            <span className="dt-problem-row__response-separator" aria-hidden="true">
              {' · '}
            </span>
          )}
          <span className="dt-problem-row__response-ticket">{ticketReference}</span>
        </span>
      )}
    </span>
  );
}

/** Whether the queue below is live. Off or failed is one condition, "not syncing". The time of the
    last sync is the command bar's freshness readout beside Refresh, so it is not repeated here. */
function getSyncFreshnessLabel(sync: DynatraceProblemSyncRecord | null): string {
  if (sync?.state === 'syncing') return 'Syncing from Dynatrace now';
  if (sync?.state === 'ok') {
    return sync.lastSuccessAt ? 'Dynatrace sync on' : 'Waiting for first Dynatrace sync';
  }
  return sync?.state === 'error'
    ? "Dynatrace isn't syncing: the last sync failed."
    : "Dynatrace isn't syncing.";
}

/** What the queue is while sync is not running: Relay's saved copy, with its age when known. The
    problems only reach Relay through a sync, so a copy without a sync time is still a saved copy. */
function getSavedCopySentence(
  sync: DynatraceProblemSyncRecord | null,
  totalProblemCount: number,
): string {
  if (sync?.lastSuccessAt) {
    return `The queue is Relay's last saved copy (from ${timeAgo(sync.lastSuccessAt)}).`;
  }
  if (totalProblemCount > 0) return "The queue is Relay's saved copy, with no recorded sync time.";
  return 'Relay has no saved problems yet.';
}

/** Relative time with the exact timestamp in a Tooltip. `focusable` lets keyboard users reach it
    where the time does not sit inside another control. */
function ExactTime({
  value,
  focusable = false,
}: Readonly<{ value: DateTimeValue; focusable?: boolean }>) {
  return (
    <Tooltip content={formatExactDateTime(value)}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <time dateTime={toDateTimeAttribute(value)} tabIndex={focusable ? 0 : undefined}>
        {formatDateTime(value)}
      </time>
    </Tooltip>
  );
}

function getAddressActionLabel(saving: boolean, addressed: boolean): string {
  if (saving) return 'Saving…';
  return addressed ? 'Return to Queue' : 'Mark Addressed';
}

const ACK_SCOPE_HELPER = 'Shared with Infra Health. The Dynatrace problem and SDP are unchanged.';

function getDispositionDetail(
  addressed: boolean,
  responseRequirementMet: boolean,
  resolverRequirementMet: boolean,
  state: DynatraceProblemStateRecord | undefined,
  resolved: boolean,
): string {
  if (addressed) {
    return `${state?.addressedBy || 'Unattributed'} · ${formatDateTime(state?.addressedAt)}`;
  }
  if (resolved) {
    return 'Dynatrace resolved this problem before anyone marked it addressed.';
  }
  if (responseRequirementMet && resolverRequirementMet) {
    return 'Add Note keeps the problem in the queue. Mark it addressed when the work is complete.';
  }
  // Missing input is reported only once a save is attempted (focus plus inline error or toast).
  return '';
}

/** Why the commit is unavailable for reasons the form cannot fix; empty when it is available. */
function getBlockedReason(connectionState: ConnectionState): string {
  if (connectionState === 'auth-failed') return 'Sign in to the Relay server first';
  if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    return 'Wait for Relay to reconnect';
  }
  return '';
}

type ProblemQueueProps = {
  problems: DynatraceProblemRecord[];
  states: Map<string, DynatraceProblemStateRecord>;
  responseSummaries: Map<string, ProblemResponseSummary>;
  selectedProblemId: string | null;
  sync: DynatraceProblemSyncRecord | null;
  totalProblemCount: number;
  totalHistoryCount: number;
  loadedHistoryCount: number;
  historyCachedPartial: boolean;
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  historyScopeCount: number;
  historyMode: boolean;
  historySort: HistorySort;
  historyResponseFilter: HistoryResponseFilter;
  onHistorySortChange: (sort: HistorySort) => void;
  queueSort: QueueSort;
  onQueueSortChange: (sort: QueueSort) => void;
  onHistoryResponseFilterChange: (filter: HistoryResponseFilter) => void;
  onLoadMoreHistory: () => void;
  onSelect: (problemId: string) => void;
  query: string;
  onClearSearch: () => void;
  /** Whether this operator can turn Dynatrace sync on here (on the Relay server, signed in on Relay Web). */
  canConfigureSync: boolean;
};

type ProblemQueueRowProps = {
  problems: DynatraceProblemRecord[];
  states: Map<string, DynatraceProblemStateRecord>;
  responseSummaries: Map<string, ProblemResponseSummary>;
  selectedProblemId: string | null;
  historyMode: boolean;
  /** Open problems in this queue per primary entity name (lower case), for the repeat tag. */
  entityCounts: Map<string, number>;
  onSelect: (problemId: string) => void;
};

/** Problems in an open queue counted by primary entity, so repeat alerts on one device show it. */
function countProblemsByEntity(problems: DynatraceProblemRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const problem of problems) {
    const name = getPrimaryEntity(problem)?.name.trim().toLowerCase();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

// Keep in step with `.dt-problem-row { min-height }` in dynatrace-problems.css.
const PROBLEM_QUEUE_ROW_HEIGHT = 84;

function emptyQueueCopy(
  integrationDisabled: boolean,
  historyMode: boolean,
  historyResponseFilter: HistoryResponseFilter,
  historyScopeCount: number,
  totalHistoryCount: number,
  query: string,
): { title: string; description: string; icon: 'search' | 'clear' } {
  if (integrationDisabled) {
    return {
      title: 'Dynatrace Problems is not configured',
      description: 'Configure the read-only integration in Settings on the Relay server.',
      icon: 'clear',
    };
  }
  if (historyMode && historyResponseFilter !== 'all' && historyScopeCount > 0) {
    return {
      title: 'No history matches this response filter',
      description: 'Choose another response filter to see the remaining resolved problems.',
      icon: 'clear',
    };
  }
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    return {
      title: `No problems match “${trimmedQuery}”`,
      description: 'The tab counts show where matches are. Clear the search to see this queue.',
      icon: 'search',
    };
  }
  if (historyMode && totalHistoryCount === 0) {
    return {
      title: 'No resolved problems in the one-year history',
      description: 'Resolved problems will remain here with their local notes and disposition.',
      icon: 'clear',
    };
  }
  return {
    title: 'No problems match this queue',
    description: 'Try another filter or clear the search.',
    icon: 'clear',
  };
}

/** `Sync Now` only when the click asks Dynatrace for current problems; otherwise the tab's
    `Refresh`, which re-reads Relay's copy. Both say they are busy while they run. */
function refreshControlCopy(
  canSyncDynatrace: boolean,
  refreshing: boolean,
): { label: string; text: string; tooltip: string } {
  if (canSyncDynatrace) {
    return refreshing
      ? {
          label: 'Syncing…',
          text: 'Syncing…',
          tooltip: "Syncing from Dynatrace, then reloading Relay's copy",
        }
      : {
          label: 'Sync Now from Dynatrace',
          text: 'Sync Now',
          tooltip:
            "Ask Dynatrace for current problems and alerting profiles now, then reload Relay's copy",
        };
  }
  return refreshing
    ? {
        label: 'Refreshing…',
        text: 'Refreshing…',
        tooltip: "Reloading Relay's copy of Dynatrace problems",
      }
    : { label: 'Refresh', text: 'Refresh', tooltip: "Reload Relay's copy of Dynatrace problems" };
}

/** Long titles keep their tail visible: a host, IP or site at the end is what tells two otherwise
    identical alerts apart, so the ellipsis goes in the middle instead of over the tail. */
const ROW_TITLE_TAIL_LENGTH = 22;
const ROW_TITLE_MAX_TAIL_LENGTH = 48;
/** Separators NOC titles are built from, strongest first (`SITE | PROD | P-1 | Summary — host`). */
const ROW_TITLE_SEPARATORS = [' | ', ' │ ', ' — ', ' – ', ' · '];

function splitProblemRowTitle(title: string): [head: string, tail: string] {
  if (title.length <= ROW_TITLE_TAIL_LENGTH * 2) return [title, ''];
  // Prefer the title's own last segment, separator included, so the cut follows its structure.
  for (const separator of ROW_TITLE_SEPARATORS) {
    const at = title.lastIndexOf(separator);
    if (at > 0 && title.length - at <= ROW_TITLE_MAX_TAIL_LENGTH) {
      return [title.slice(0, at), title.slice(at)];
    }
  }
  let cut = title.length - ROW_TITLE_TAIL_LENGTH;
  // Otherwise start the tail at a word boundary when one is close, so it never opens mid-word.
  const space = title.lastIndexOf(' ', cut);
  if (space > 0 && cut - space <= 8) cut = space;
  return [title.slice(0, cut), title.slice(cut)];
}

function ProblemRowTitle({ title }: Readonly<{ title: string }>) {
  const [head, tail] = splitProblemRowTitle(title);
  return (
    <span className="dt-problem-row__title">
      <span className="dt-problem-row__title-head">{head}</span>
      {tail && <span className="dt-problem-row__title-tail">{tail}</span>}
    </span>
  );
}

// Not wrapped in React.memo: react-window already memoises whatever it is handed, with a
// comparator that understands its own `style`/`ariaAttributes` props. A MemoExoticComponent
// also widens the return type to ReactNode, which its `rowComponent` prop rejects.
function ProblemQueueRow({
  index,
  style,
  ariaAttributes,
  ...data
}: RowComponentProps<ProblemQueueRowProps>) {
  const {
    problems,
    states,
    responseSummaries,
    selectedProblemId,
    historyMode,
    entityCounts,
    onSelect,
  } = data;
  const problem = problems[index];
  if (!problem) return null;
  const addressed = isProblemAddressed(states.get(problem.problemId), problem);
  const responseSummary = responseSummaries.get(problem.problemId);
  const selected = problem.problemId === selectedProblemId;
  const closed = problem.status === 'CLOSED';
  // The pip says resolved; the label keeps the category in both views (History implies Resolved).
  const signalTone = closed ? 'resolved' : severityTone(problem.severity);
  const tone = severityTone(problem.severity);
  const statusLabel = severityLabel(problem.severity);
  const time = closed ? formatResolvedTime(problem) : formatDuration(problem);
  const primaryEntity = getPrimaryEntity(problem);
  const entityProblemCount = primaryEntity
    ? (entityCounts.get(primaryEntity.name.trim().toLowerCase()) ?? 0)
    : 0;
  const displayTitle = getDynatraceProblemDisplayTitle(problem);
  const problemId = problem.displayId || problem.problemId;

  return (
    <div style={style} {...ariaAttributes}>
      <button
        type="button"
        className={`dt-problem-row${selected ? ' dt-problem-row--selected' : ''}`}
        onClick={() => onSelect(problem.problemId)}
        aria-pressed={selected}
        // One short name instead of every line run together: title, state, age, then ID.
        aria-label={[
          displayTitle,
          statusLabel,
          closed ? 'resolved' : '',
          addressed ? 'addressed' : '',
          closed ? `ended ${time}, lasted ${formatDuration(problem)}` : formatDuration(problem),
          entityProblemCount > 1 ? `${entityProblemCount} open for this entity` : '',
          problemId,
        ]
          .filter(Boolean)
          .join(', ')}
      >
        <span
          className={`dt-problem-row__signal dt-problem-row__signal--${signalTone}`}
          aria-hidden="true"
        />
        <span className="dt-problem-row__content">
          <span className="dt-problem-row__topline">
            <span className={`dt-problem-badge dt-problem-badge--${tone}`}>{statusLabel}</span>
            {addressed && (
              <span className="dt-problem-badge dt-problem-badge--addressed">Addressed</span>
            )}
            <span className="dt-problem-row__time">{time}</span>
          </span>
          <ProblemRowTitle title={displayTitle} />
          <span className="dt-problem-row__context">
            {primaryEntity && (
              <span className="dt-problem-row__entity">
                <span>{primaryEntity.kind}</span>
                <strong>{primaryEntity.name}</strong>
                {primaryEntity.additionalCount > 0 && (
                  <small>+{primaryEntity.additionalCount}</small>
                )}
              </span>
            )}
            {entityProblemCount > 1 && (
              <span className="dt-problem-row__repeat">
                {entityProblemCount} open for this entity
              </span>
            )}
            {/* Many titles already carry the ID (PROD | P-123 | …); then it isn't repeated here. */}
            {!displayTitle.includes(problemId) && (
              <span className="dt-problem-row__id">{problemId}</span>
            )}
            {historyMode && <ProblemResponseMetadata summary={responseSummary} />}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Persistent polite status for the queue's sync state (mounted with the queue, text changes only,
    per DESIGN.md Live regions): announces sync starting, stopping or failing and the Dynatrace
    result limit, so the visible sync banner and notices need no live role of their own. */
function QueueSyncAnnouncer({
  sync,
  totalProblemCount,
}: Readonly<Pick<ProblemQueueProps, 'sync' | 'totalProblemCount'>>) {
  const state = sync?.state ?? 'disabled';
  const parts: string[] = [];
  if (state !== 'disabled' || totalProblemCount > 0) parts.push(getSyncFreshnessLabel(sync));
  if (sync?.resultTruncated) {
    parts.push('Dynatrace result limit reached; Relay history may be incomplete.');
  }
  return (
    <output className="sr-only" aria-atomic="true">
      {parts.join(' ')}
    </output>
  );
}

/** Sync state sits with the queue it describes so an operator can tell whether these problems are
    live; the last-sync time is the freshness readout beside Refresh. Not syncing (off or failed) is
    a warning banner in the queue (diamond, warning ink and rail) that gives the cause, what the
    queue is (Relay's saved copy and its age) and, when sync is off, who can turn it on, plus Open
    Dynatrace Settings where this operator can. */
function QueueSyncState({
  sync,
  totalProblemCount,
  canConfigureSync,
  placement,
}: Readonly<
  Pick<ProblemQueueProps, 'sync' | 'totalProblemCount' | 'canConfigureSync'> & {
    /** Synced and syncing sit quietly in the queue header; not syncing is a banner below it. */
    placement: 'header' | 'banner';
  }
>) {
  const state = sync?.state ?? 'disabled';
  if (state === 'disabled' && totalProblemCount === 0) return null;
  // Off or failed means the queue (and the sidebar count) is Relay's saved copy, not live Dynatrace.
  const stale = state === 'disabled' || state === 'error';
  if (stale !== (placement === 'banner')) return null;
  return (
    <div
      className={`dt-problems__sync-state dt-problems__sync-state--${state}${
        stale ? ' dt-problems__sync-state--stale' : ' dt-problems__sync-state--header'
      }`}
    >
      <strong className="dt-problems__sync-label">{getSyncFreshnessLabel(sync)}</strong>
      {stale && (
        <span className="dt-problems__sync-owner">
          {getSavedCopySentence(sync, totalProblemCount)}
          {state === 'disabled' &&
            (canConfigureSync
              ? ' An Administrator can turn sync on in Settings › Dynatrace.'
              : ' An Administrator on the Relay server can turn sync on in Settings › Dynatrace.')}
          {state === 'disabled' && canConfigureSync && (
            <>
              {' '}
              <button
                type="button"
                className="dt-problems__sync-action"
                onClick={() => openSettingsSection('dynatrace')}
              >
                Open Dynatrace Settings
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function ProblemQueue({
  problems,
  states,
  responseSummaries,
  selectedProblemId,
  sync,
  totalProblemCount,
  totalHistoryCount,
  loadedHistoryCount,
  historyCachedPartial,
  hasMoreHistory,
  loadingMoreHistory,
  historyScopeCount,
  historyMode,
  historySort,
  historyResponseFilter,
  onHistorySortChange,
  queueSort,
  onQueueSortChange,
  onHistoryResponseFilterChange,
  onLoadMoreHistory,
  onSelect,
  query,
  onClearSearch,
  canConfigureSync,
}: Readonly<ProblemQueueProps>) {
  const rowProps = useMemo<ProblemQueueRowProps>(
    () => ({
      problems,
      states,
      responseSummaries,
      selectedProblemId,
      historyMode,
      entityCounts: historyMode ? new Map() : countProblemsByEntity(problems),
      onSelect,
    }),
    [historyMode, onSelect, problems, responseSummaries, selectedProblemId, states],
  );
  const listRef = useListRef(null);
  const selectedIndex = problems.findIndex((problem) => problem.problemId === selectedProblemId);
  // Keyboard cycling can select a row outside the virtualised window; keep it visible.
  useEffect(() => {
    if (selectedIndex >= 0) listRef.current?.scrollToRow({ index: selectedIndex, align: 'smart' });
  }, [listRef, selectedIndex]);
  let queueContents: React.ReactNode;
  if (problems.length === 0) {
    const integrationDisabled = sync?.state === 'disabled' && totalProblemCount === 0;
    const { title, description, icon } = emptyQueueCopy(
      integrationDisabled,
      historyMode,
      historyResponseFilter,
      historyScopeCount,
      totalHistoryCount,
      query,
    );
    queueContents = (
      <EmptyState
        title={title}
        description={description}
        glyph={
          icon === 'search' ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              data-icon="search"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              data-icon="clear"
              aria-hidden="true"
            >
              <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          )
        }
        actions={
          query.trim() &&
          !integrationDisabled && (
            <TactileButton size="sm" onClick={onClearSearch}>
              Clear Search
            </TactileButton>
          )
        }
      />
    );
  } else {
    queueContents = (
      <div className="dt-problems__queue-list">
        <AutoSizer
          renderProp={({ height, width }) => (
            <List
              listRef={listRef}
              style={{ height: height ?? 0, width: width ?? 0 }}
              rowCount={problems.length}
              rowHeight={PROBLEM_QUEUE_ROW_HEIGHT}
              rowComponent={ProblemQueueRow}
              rowProps={rowProps}
              overscanCount={6}
            />
          )}
        />
      </div>
    );
  }
  const historyAvailability = historyCachedPartial ? 'cached' : 'loaded';
  const problemCountLabel = historyMode
    ? `${problems.length.toLocaleString()} shown · ${loadedHistoryCount.toLocaleString()}/${totalHistoryCount.toLocaleString()} ${historyAvailability}`
    : `${problems.length.toLocaleString()} shown`;
  const historyCountLabel = `${problems.length.toLocaleString()} of ${totalHistoryCount.toLocaleString()}`;

  return (
    <section
      className="dt-problems__queue"
      aria-label={historyMode ? 'Dynatrace problem history' : 'Dynatrace problem queue'}
    >
      {/* One header row in every view: the view's compact order (and in History its response
          filter), the count where the tab doesn't already show it, then sync state. */}
      <div className="dt-problems__section-heading">
        {historyMode ? (
          <>
            <label className="dt-problems__queue-sort">
              <span className="sr-only">Sort history</span>
              <select
                value={historySort}
                onChange={(event) => onHistorySortChange(event.target.value as HistorySort)}
              >
                <option value="newest">Newest first</option>
                <option value="addressed-first">Addressed first</option>
                <option value="response-first">NOC response first</option>
                <option value="no-response-first">No NOC response first</option>
              </select>
            </label>
            <label className="dt-problems__queue-sort">
              <span className="sr-only">Response filter</span>
              <select
                value={historyResponseFilter}
                onChange={(event) =>
                  onHistoryResponseFilterChange(event.target.value as HistoryResponseFilter)
                }
              >
                <option value="all">All responses</option>
                <option value="local-response">Has NOC response</option>
                <option value="addressed">Addressed</option>
                <option value="notes">Has NOC notes</option>
                <option value="tickets">Has ticket</option>
                <option value="none">No NOC response</option>
              </select>
            </label>
            <Tooltip content={`${problemCountLabel}. Resolved problems are retained for one year.`}>
              {/* Focusable so keyboard users reach the retention note (WAI-ARIA tooltip pattern). */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
              <span className="dt-problems__section-count" tabIndex={0}>
                {historyCountLabel}
              </span>
            </Tooltip>
          </>
        ) : (
          <label className="dt-problems__queue-sort">
            <span className="sr-only">Sort queue</span>
            <select
              value={queueSort}
              onChange={(event) => onQueueSortChange(event.target.value as QueueSort)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        )}
        {/* A stable live region in both modes: toggling a live region's role in place is
            unreliable, so the count is always a polite atomic status (filter and history-page
            changes read out as "N shown"). */}
        {/* Spoken only: the tab (or History's short count) shows the number. */}
        <span // NOSONAR - role=status is the live-region pattern; <output> would imply a calculated result.
          className="sr-only"
          role="status"
          aria-atomic="true"
        >
          {problemCountLabel}
        </span>
        <QueueSyncState
          sync={sync}
          totalProblemCount={totalProblemCount}
          canConfigureSync={canConfigureSync}
          placement="header"
        />
      </div>
      <QueueSyncAnnouncer sync={sync} totalProblemCount={totalProblemCount} />
      <QueueSyncState
        sync={sync}
        totalProblemCount={totalProblemCount}
        canConfigureSync={canConfigureSync}
        placement="banner"
      />
      {queueContents}
      {historyMode && hasMoreHistory && (
        <div className="dt-problems__history-pagination">
          <button type="button" onClick={onLoadMoreHistory} disabled={loadingMoreHistory}>
            {loadingMoreHistory ? 'Loading…' : 'Load 100 More'}
          </button>
        </div>
      )}
    </section>
  );
}

type ProblemDetailProps = {
  problem: DynatraceProblemRecord | undefined;
  state: DynatraceProblemStateRecord | undefined;
  notes: DynatraceProblemNoteRecord[];
  hasPendingDispositionResponse: boolean;
  resolverDraft: string;
  /** Analyst names synced from Dynatrace, or the fallback list. */
  resolvers: readonly DynatraceNocAnalyst[];
  noteDraft: string;
  connectionState: ConnectionState;
  savingAction: ProblemSavingAction;
  noteInputRef: RefObject<HTMLTextAreaElement | null>;
  primaryActionRef: RefObject<HTMLButtonElement | null>;
  resolverSelectRef: RefObject<HTMLSelectElement | null>;
  /** Inline error at the resolver select when a save was attempted without a name. */
  resolverError: string;
  onNoteDraftChange: (value: string) => void;
  onResolverDraftChange: (value: string) => void;
  onSaveResponse: () => void;
  onAddressToggle: () => void;
  onOpenDynatrace: (problem: DynatraceProblemRecord) => void;
  onCopyTicket: (reference: string) => void;
  onOpenTicket: (reference: string) => void;
  onEditNote: (recordId: string, text: string) => Promise<void>;
  onDeleteNote: (recordId: string) => Promise<void>;
};

type ProblemResolverSelectProps = {
  label: string;
  value: string;
  disabled: boolean;
  error: string;
  selectRef: RefObject<HTMLSelectElement | null>;
  options: readonly DynatraceNocAnalyst[];
  onChange: (value: string) => void;
};

function ProblemResolverSelect({
  label,
  value,
  disabled,
  error,
  selectRef,
  options,
  onChange,
}: Readonly<ProblemResolverSelectProps>) {
  const errorId = useId();
  return (
    <div className="dt-problem-resolver-field">
      <label className="dt-problem-resolver">
        <span>{label}</span>
        <select
          ref={selectRef}
          name="dynatrace-problem-resolver"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <option value="" disabled>
            Select your name
          </option>
          {options.map((analyst) => (
            <option key={dynatraceAnalystKey(analyst)} value={dynatraceAnalystKey(analyst)}>
              {analyst.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// The bar docks over the scrolling detail pane; publish its height so the pane's
// scroll-padding keeps focused or scrolled-to content clear of it.
function usePublishedResponseBarHeight(barRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest<HTMLElement>('.dt-problems__detail');
    if (!bar || !scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      scroller.style.setProperty('--dt-response-bar-height', `${bar.offsetHeight}px`);
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      scroller.style.removeProperty('--dt-response-bar-height');
    };
  }, [barRef]);
}

const BLOCKED_REASON_ID = 'dt-problem-action-blocked';

function describedByIds(showScope: boolean, blocked: boolean): string | undefined {
  const ids = [
    showScope ? 'dt-problem-action-scope' : null,
    blocked ? BLOCKED_REASON_ID : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function getDispositionTitle(addressed: boolean, resolved: boolean): string {
  if (addressed) return 'Addressed';
  return resolved ? 'Not recorded' : 'Unaddressed';
}

type ProblemResponseBarProps = Omit<
  ProblemDetailProps,
  | 'problem'
  | 'notes'
  | 'onOpenDynatrace'
  | 'onCopyTicket'
  | 'onOpenTicket'
  | 'onEditNote'
  | 'onDeleteNote'
> & { problem: DynatraceProblemRecord };

function ProblemResponseBar({
  problem,
  state,
  hasPendingDispositionResponse,
  resolverDraft,
  resolvers,
  noteDraft,
  connectionState,
  savingAction,
  noteInputRef,
  primaryActionRef,
  resolverSelectRef,
  resolverError,
  onNoteDraftChange,
  onResolverDraftChange,
  onSaveResponse,
  onAddressToggle,
}: Readonly<ProblemResponseBarProps>) {
  const barRef = useRef<HTMLElement>(null);
  usePublishedResponseBarHeight(barRef);
  const addressed = isProblemAddressed(state, problem);
  const blockedReason = getBlockedReason(connectionState);
  const hasDraftedResponse = noteDraft.trim().length > 0;
  const responseRequirementMet = hasDraftedResponse || hasPendingDispositionResponse;
  const resolverRequirementMet = resolverDraft.length > 0;
  const resolved = problem.status === 'CLOSED';
  const dispositionDetail = getDispositionDetail(
    addressed,
    responseRequirementMet,
    resolverRequirementMet,
    state,
    resolved,
  );
  // A note can always be added. On an unaddressed open problem it is the secondary action beside
  // Mark Addressed; once addressed or resolved it becomes the primary action.
  const addNoteIsPrimary = resolved || addressed;
  const addNoteLabel = savingAction === 'response' ? 'Saving…' : 'Add Note';
  const addressLabel = getAddressActionLabel(savingAction === 'address', addressed);
  const actionsDisabled = savingAction !== null || blockedReason !== '';
  const modKeyLabel = globalThis.api?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const showAckScopeHelper = !addressed && !resolved;
  const noteInputId = useId();
  const primaryActionDescribedBy = describedByIds(showAckScopeHelper, blockedReason !== '');
  const primaryShortcut = `${modKeyLabel}+Enter`;
  const addNoteShortcut = `Shift+${modKeyLabel}+Enter`;
  const dispositionTitle = getDispositionTitle(addressed, resolved);

  // In reading order directly under the problem facts (status → note → who → commit), ahead of
  // the SDP and system context. It docks to the bottom of the pane whenever a long header pushes
  // it below the fold.
  return (
    <section ref={barRef} className="dt-problem-detail__actionbar" aria-label="NOC response">
      <div className="dt-problem-detail__response-copy">
        {/* Unaddressed only repeats the tab the operator is in; the line earns its place once a
            problem is addressed (by whom) or resolved. */}
        {(addressed || resolved) && (
          <p className="dt-problem-detail__response-status">
            <span>NOC response</span>
            <strong>{dispositionTitle}</strong>
          </p>
        )}
        <small>
          {dispositionDetail}
          {/* Spoken with Mark Addressed and shown in its tooltip, not as a standing sentence. */}
          {showAckScopeHelper && (
            <span id="dt-problem-action-scope" className="sr-only">
              {ACK_SCOPE_HELPER}
            </span>
          )}
        </small>
      </div>
      <div className="dt-problem-note-composer">
        <div className="dt-problem-note-composer__label-row">
          <label htmlFor={noteInputId}>NOC note</label>
          <span className="dt-problem-note-composer__count">
            {noteDraft.length.toLocaleString()} / 5,000
          </span>
        </div>
        <textarea
          id={noteInputId}
          ref={noteInputRef}
          name="dynatrace-problem-note"
          autoComplete="off"
          value={noteDraft}
          onChange={(event) => onNoteDraftChange(event.target.value)}
          placeholder="Record investigation details, mitigation, ownership, or next steps"
          maxLength={5_000}
          disabled={actionsDisabled}
          aria-keyshortcuts="Control+Enter Meta+Enter Shift+Control+Enter Shift+Meta+Enter"
        />
      </div>
      <div className="dt-problem-detail__actionbar-row">
        <ProblemResolverSelect
          label="Analyst"
          value={resolverDraft}
          onChange={onResolverDraftChange}
          disabled={actionsDisabled}
          error={resolverError}
          selectRef={resolverSelectRef}
          options={resolvers}
        />
        <div className="dt-problem-detail__commit">
          {blockedReason && (
            <span id={BLOCKED_REASON_ID} className="sr-only">
              {blockedReason}
            </span>
          )}
          {addNoteIsPrimary ? (
            <>
              {!resolved && (
                // Return to Queue stays click-only so a shortcut never reopens a problem.
                <TactileButton
                  variant="secondary"
                  onClick={onAddressToggle}
                  disabled={actionsDisabled}
                  tooltip={blockedReason || 'Removes the ack in Infra Health too'}
                >
                  {addressLabel}
                </TactileButton>
              )}
              <TactileButton
                ref={primaryActionRef}
                variant="primary"
                className="dt-problems__primary-action"
                onClick={onSaveResponse}
                disabled={actionsDisabled}
                aria-describedby={primaryActionDescribedBy}
                data-submit-shortcut="true"
                data-add-note-shortcut="true"
                aria-keyshortcuts="Control+Enter Meta+Enter Shift+Control+Enter Shift+Meta+Enter"
                tooltip={blockedReason || `${addNoteLabel} (${primaryShortcut})`}
              >
                {addNoteLabel}
              </TactileButton>
            </>
          ) : (
            <>
              <TactileButton
                variant="secondary"
                onClick={onSaveResponse}
                disabled={actionsDisabled}
                data-add-note-shortcut="true"
                aria-keyshortcuts="Shift+Control+Enter Shift+Meta+Enter"
                tooltip={blockedReason || `Add Note, keep it in the queue (${addNoteShortcut})`}
              >
                {addNoteLabel}
              </TactileButton>
              <TactileButton
                ref={primaryActionRef}
                variant="primary"
                className="dt-problems__primary-action"
                onClick={onAddressToggle}
                disabled={actionsDisabled}
                aria-describedby={primaryActionDescribedBy}
                data-submit-shortcut="true"
                aria-keyshortcuts="Control+Enter Meta+Enter"
                tooltip={
                  blockedReason || `${addressLabel} (${primaryShortcut}). ${ACK_SCOPE_HELPER}`
                }
              >
                {addressLabel}
              </TactileButton>
            </>
          )}
        </div>
      </div>
      {connectionState === 'offline' && (
        <div className="dt-problems__offline-note">
          You are offline. Changes will sync when Relay reconnects.
        </div>
      )}
      {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
        <div className="dt-problems__offline-note">
          Relay is reconnecting. Wait for the connection to settle before changing local status or
          adding notes.
        </div>
      )}
      {connectionState === 'auth-failed' && (
        <div className="dt-problems__offline-note">
          Sign in to the Relay server before changing local status or adding notes.
        </div>
      )}
    </section>
  );
}

/** The notes list itself is not live (switching problems would read the whole history out);
    this stable sr-only status says only that a note landed on the problem already in view. */
function NoteAddedAnnouncement({
  problemId,
  count,
}: Readonly<{ problemId: string; count: number }>) {
  const [tracked, setTracked] = useState({ problemId, count, message: '' });
  if (tracked.problemId !== problemId || tracked.count !== count) {
    const added = tracked.problemId === problemId && count > tracked.count;
    setTracked({
      problemId,
      count,
      message: added ? `Note added. ${count} in NOC response history.` : '',
    });
  }
  return (
    <output className="sr-only" aria-atomic="true">
      {tracked.message}
    </output>
  );
}

function ProblemDetail({
  problem,
  state,
  notes,
  hasPendingDispositionResponse,
  resolverDraft,
  resolvers,
  noteDraft,
  connectionState,
  savingAction,
  noteInputRef,
  primaryActionRef,
  resolverSelectRef,
  resolverError,
  onNoteDraftChange,
  onResolverDraftChange,
  onSaveResponse,
  onAddressToggle,
  onOpenDynatrace,
  onCopyTicket,
  onOpenTicket,
  onEditNote,
  onDeleteNote,
}: Readonly<ProblemDetailProps>) {
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  if (!problem) {
    return (
      <section className="dt-problems__detail" aria-label="Selected problem details">
        <EmptyState
          title="Select a problem"
          description="Problem context, NOC response, and response history will appear here."
        />
      </section>
    );
  }

  const addressed = isProblemAddressed(state, problem);
  const tone = problem.status === 'CLOSED' ? 'resolved' : severityTone(problem.severity);
  const statusLabel =
    problem.status === 'CLOSED' ? 'Resolved by Dynatrace' : severityLabel(problem.severity);
  const displayTitle = getDynatraceProblemDisplayTitle(problem);
  const contextTitles = [displayTitle, problem.title].map((title) =>
    title.trim().replace(/\s+/gu, ' ').toLowerCase(),
  );
  const hasDistinctDisplayTitle = contextTitles[0] !== contextTitles[1];
  const description = problem.workflowDescription?.trim() ?? '';
  const hasDescription = Boolean(description) && describesMoreThan(description, [displayTitle]);
  // A description that opens with the Dynatrace problem's name already shows it as its heading.
  const descriptionNamesProblem =
    hasDescription &&
    leadingHeading(description).trim().replace(/\s+/gu, ' ').toLowerCase() === contextTitles[1];
  const showDynatraceTitle = hasDistinctDisplayTitle && !descriptionNamesProblem;
  const hasProblemContext = showDynatraceTitle || hasDescription;
  const alertingProfiles = (problem.alertingProfiles ?? []).join(', ');
  return (
    <section className="dt-problems__detail" aria-label="Selected problem details">
      <div className="dt-problem-detail">
        <header className="dt-problem-detail__header">
          <div className="dt-problem-detail__badges">
            <span className={`dt-problem-badge dt-problem-badge--${tone}`}>{statusLabel}</span>
            {addressed && (
              <span className="dt-problem-badge dt-problem-badge--addressed">
                {state?.addressedBy?.trim()
                  ? `Addressed by ${state.addressedBy.trim()}`
                  : 'Addressed'}
              </span>
            )}
            <div className="dt-problem-detail__identity">
              {/* Many titles already carry the ID (PROD | P-123 | …); then it isn't repeated here. */}
              {!displayTitle.includes(problem.displayId || problem.problemId) && (
                <span className="dt-problem-detail__id">
                  {problem.displayId || problem.problemId}
                </span>
              )}
              <span>
                Started <ExactTime value={problem.startTime} focusable />
              </span>
              <span>Duration {formatDuration(problem)}</span>
              {/* In the title band so it is in view at compact heights (the footer sits below the
                  fold); ↗ marks that it leaves Relay for the browser. */}
              <button
                type="button"
                className="dt-problem-detail__open-dynatrace"
                onClick={() => onOpenDynatrace(problem)}
              >
                Open Dynatrace <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
          <h3>{displayTitle}</h3>
        </header>

        <div className="dt-problem-detail__facts">
          <div>
            <span>Impact</span>
            <strong>
              {problem.impactLevel.charAt(0) + problem.impactLevel.slice(1).toLowerCase()}
            </strong>
          </div>
          {/* Dynatrace often names no root cause; an empty fact would only say so. */}
          {problem.rootCauseName && (
            <div>
              <span>Root cause</span>
              <Tooltip content={problem.rootCauseName} block>
                {/* Focusable: a long name clamps to two lines, and focus reveals all of it. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                <strong tabIndex={0}>{problem.rootCauseName}</strong>
              </Tooltip>
            </div>
          )}
          <div>
            <span>Alerting profile</span>
            {alertingProfiles ? (
              <Tooltip content={alertingProfiles} block>
                {/* Focusable: the list truncates, and focus reveals all of it. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                <strong tabIndex={0}>{alertingProfiles}</strong>
              </Tooltip>
            ) : (
              <strong>Not assigned</strong>
            )}
          </div>
        </div>
        <ProblemResponseBar
          problem={problem}
          state={state}
          hasPendingDispositionResponse={hasPendingDispositionResponse}
          resolverDraft={resolverDraft}
          resolvers={resolvers}
          noteDraft={noteDraft}
          connectionState={connectionState}
          savingAction={savingAction}
          noteInputRef={noteInputRef}
          primaryActionRef={primaryActionRef}
          resolverSelectRef={resolverSelectRef}
          resolverError={resolverError}
          onNoteDraftChange={onNoteDraftChange}
          onResolverDraftChange={onResolverDraftChange}
          onSaveResponse={onSaveResponse}
          onAddressToggle={onAddressToggle}
        />

        {hasProblemContext && (
          <div className="dt-problem-detail__section dt-problem-detail__workflow-context">
            <h4 className="dt-problem-detail__section-title">Problem details</h4>
            {hasDescription && (
              <ProblemDescription
                key={problem.problemId}
                source={description}
                omitTitles={[displayTitle]}
              />
            )}
            {showDynatraceTitle && (
              <dl className="dt-problem-detail__workflow-metadata">
                <div>
                  <dt>Dynatrace problem</dt>
                  <dd>{problem.title}</dd>
                </div>
              </dl>
            )}
          </div>
        )}

        {/* Supporting context follows the response: relationship rows share one bordered list,
            each one line until opened. */}
        <div className="dt-problem-detail__context">
          <SdpProblemTickets problem={problem} />
          <SdpProblemChanges problem={problem} />
          <details className="sdp-disclosure dt-problem-systems">
            <summary>
              Systems affected{' '}
              <span className="ticket-mode-note">
                {
                  new Set(
                    [...problem.affectedEntities, ...problem.impactedEntities].map(
                      (entity) => entity.id,
                    ),
                  ).size
                }
              </span>
            </summary>
            <div className="dt-problem-detail__section">
              <h4 className="dt-problem-detail__section-title">Affected entities</h4>
              <EntityList entities={problem.affectedEntities} />
            </div>

            <div className="dt-problem-detail__section">
              <h4 className="dt-problem-detail__section-title">Impacted entities</h4>
              <EntityList entities={problem.impactedEntities} />
            </div>
          </details>
        </div>

        <div className="dt-problem-detail__section dt-problem-detail__notes">
          {/* Programmatic focus target after a note is deleted, so focus never drops to the page. */}
          <h4 ref={historyHeadingRef} className="dt-problem-detail__section-title" tabIndex={-1}>
            <span>NOC response history</span>
            {notes.length > 0 && <span>{notes.length}</span>}
          </h4>
          <NoteAddedAnnouncement problemId={problem.problemId} count={notes.length} />
          <div className="dt-problem-notes">
            {notes.length === 0 ? (
              <div className="dt-problem-notes__empty">No NOC response history yet.</div>
            ) : (
              [...notes].reverse().map((note) => {
                const ticketReference = parseDynatraceTicketReferenceNote(note.note);
                return (
                  // Keyed by note ID: an edit is a newer row, and remounting would drop focus.
                  <article className="dt-problem-note" key={note.noteId || note.id}>
                    <div className="dt-problem-note__meta">
                      <strong>{note.author || 'Unattributed'}</strong>
                      <ExactTime value={note.grailTs || note.created} focusable />
                      {getDynatraceNocSourceLabel(note.source) && (
                        <span>in {getDynatraceNocSourceLabel(note.source)}</span>
                      )}
                      {note.sync === 'pending' && <span>Waiting to sync</span>}
                      {note.sync === 'error' && (
                        <Tooltip content={note.syncError || 'Dynatrace did not accept this note.'}>
                          {/* Focusable so keyboard users reach the reason (WAI-ARIA tooltip pattern). */}
                          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                          <span className="field-error" tabIndex={0}>
                            Not synced, kept in Relay
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    <DynatraceProblemNoteBody
                      text={note.note}
                      label={`note by ${note.author || 'Unattributed'}, ${formatDateTime(note.grailTs || note.created)}`}
                      onDeleted={() => historyHeadingRef.current?.focus()}
                      disabled={getBlockedReason(connectionState) !== ''}
                      onEdit={(text) => onEditNote(note.id, text)}
                      onDelete={() => onDeleteNote(note.id)}
                    >
                      {ticketReference ? (
                        <div className="dt-problem-note__ticket">
                          <span>Ticket reference, not linked to SDP</span>
                          <strong>{ticketReference}</strong>
                          <div className="dt-problem-note__ticket-actions">
                            <button
                              type="button"
                              aria-label={`Copy ${ticketReference}`}
                              onClick={() => onCopyTicket(ticketReference)}
                            >
                              Copy
                            </button>
                            {getSafeTicketUrl(ticketReference) && (
                              <button
                                type="button"
                                aria-label={`Open Reference ${ticketReference}`}
                                onClick={() => onOpenTicket(ticketReference)}
                              >
                                Open Reference <span aria-hidden="true">↗</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p>{note.note}</p>
                      )}
                    </DynatraceProblemNoteBody>
                  </article>
                );
              })
            )}
          </div>
        </div>

        <footer className="dt-problem-detail__footer">
          <span>Dynatrace ID {problem.problemId}</span>
        </footer>
      </div>
    </section>
  );
}

export const DynatraceProblemsTab: React.FC<{
  relayMode?: PublicRelayConfig['mode'];
  active?: boolean;
  ticketOpenRequest?: { problemId: string; sequence: number };
}> = ({ relayMode, active = true, ticketOpenRequest }) => {
  const { showToast } = useToast();
  const { session: privilegedSession } = usePrivilegedAccess();
  const {
    problems,
    stateByProblemId,
    notesByProblemId,
    sync,
    totalHistoryCount,
    hasMoreHistory,
    loadingMoreHistory,
    historyCachedPartial,
    loadMoreHistory,
    loading,
    error,
    setAddressed,
    addNote,
    editNote,
    deleteNote,
    refetch,
    resolvers,
  } = useDynatraceProblems();
  const [filter, setFilter] = useState<ProblemFilter>('unaddressed');
  const [query, setQuery] = useState('');
  const openedTicketRequest = useRef<number | undefined>(undefined);
  const [historyPreferences, setHistoryPreferences] =
    useState<HistoryPreferences>(readHistoryPreferences);
  const { sort: historySort, responseFilter: historyResponseFilter } = historyPreferences;
  const [queueSort, setQueueSort] = useState<QueueSort>(readQueueSort);
  const handleQueueSortChange = useCallback((sort: QueueSort) => {
    setQueueSort(sort);
    writeQueueSort(sort);
  }, []);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const resolverSelectRef = useRef<HTMLSelectElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSelectedProblemIdRef = useRef<string | null>(null);
  /** Index of the selection in the current view, so the next problem inherits it on removal. */
  const selectedIndexRef = useRef(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => onConnectionStateChange(setConnectionState), []);

  useEffect(() => {
    if (selectedProblemId) lastSelectedProblemIdRef.current = selectedProblemId;
  }, [selectedProblemId]);

  useEffect(() => {
    writeHistoryPreferences(historyPreferences);
  }, [historyPreferences]);

  const handleHistorySortChange = useCallback((sort: HistorySort) => {
    setHistoryPreferences((current) => ({ ...current, sort }));
  }, []);

  const handleHistoryResponseFilterChange = useCallback((responseFilter: HistoryResponseFilter) => {
    setHistoryPreferences((current) => ({ ...current, responseFilter }));
  }, []);

  const { counts, filterCounts, responseSummaries, filteredProblems, historyScopeCount } = useMemo(
    () =>
      buildDynatraceProblemQueueModel({
        problems,
        stateByProblemId,
        notesByProblemId,
        totalHistoryCount,
        filter,
        query,
        historySort,
        historyResponseFilter,
        queueSort,
      }),
    [
      queueSort,
      filter,
      historyResponseFilter,
      historySort,
      notesByProblemId,
      problems,
      query,
      stateByProblemId,
      totalHistoryCount,
    ],
  );

  const focusSelectedProblemNote = useCallback(() => noteInputRef.current?.focus(), []);
  /** Undo puts the problem back in Unaddressed; follow it there. */
  const reselectUndoneProblem = useCallback((problemId: string) => {
    setFilter('unaddressed');
    setSelectedProblemId(problemId);
  }, []);
  const focusSearch = useCallback(() => searchInputRef.current?.focus(), []);
  const selectFilterByIndex = useCallback((index: number) => {
    const next = PROBLEM_FILTERS[index];
    if (next) setFilter(next.id);
  }, []);
  const submitResponseShortcut = useCallback(() => {
    const button = primaryActionRef.current;
    // click() is a no-op on a disabled button; an enabled one reports any missing input itself.
    if (button?.dataset.submitShortcut === 'true') button.click();
  }, []);
  const addNoteShortcut = useCallback(() => {
    document
      .querySelector<HTMLButtonElement>('.dt-problems [data-add-note-shortcut="true"]')
      ?.click();
  }, []);
  const reportEmptyView = useCallback(
    () => showToast('No problems in this view.', 'info'),
    [showToast],
  );
  const visibleProblemIds = useMemo(
    () => filteredProblems.map((problem) => problem.problemId),
    [filteredProblems],
  );

  useDynatraceProblemShortcuts({
    active,
    visibleProblemIds,
    selectedProblemId: selectedProblemId ?? lastSelectedProblemIdRef.current,
    filterCount: PROBLEM_FILTERS.length,
    onSelectProblem: setSelectedProblemId,
    onFocusNote: focusSelectedProblemNote,
    onFocusSearch: focusSearch,
    onSelectFilter: selectFilterByIndex,
    onSubmitResponse: submitResponseShortcut,
    onAddNote: addNoteShortcut,
    onEmptyView: reportEmptyView,
  });

  const selectedProblem = problems.find((problem) => problem.problemId === selectedProblemId);
  const selectedState = selectedProblem
    ? stateByProblemId.get(selectedProblem.problemId)
    : undefined;
  const selectedNotes = selectedProblem
    ? (notesByProblemId.get(selectedProblem.problemId) ?? [])
    : [];
  const {
    noteDraft,
    resolverDraft,
    resolverError,
    hasUnsavedDraft,
    hasPendingDispositionResponse,
    savingAction,
    setNoteDraft,
    setResolverDraft,
    handleSaveResponse,
    handleAddressToggle,
    runExclusive,
  } = useProblemDispositionWorkflow({
    selectedProblem,
    selectedState,
    resolvers,
    addNote,
    setAddressed,
    noteInputRef,
    resolverSelectRef,
    onAddressUndone: reselectUndoneProblem,
  });

  useEffect(() => {
    const index = filteredProblems.findIndex((problem) => problem.problemId === selectedProblemId);
    if (index >= 0) {
      selectedIndexRef.current = index;
      return;
    }
    // Re-selecting when the current problem falls out of the queue is a convenience and
    // never worth interrupting work for: hold the selection while a response is drafted.
    if (hasUnsavedDraft) return;
    // A problem that leaves the view (marked addressed, resolved) hands selection to the one that
    // took its place, so working down the queue never jumps back to the top.
    const nextIndex = Math.min(selectedIndexRef.current, filteredProblems.length - 1);
    setSelectedProblemId(filteredProblems[Math.max(nextIndex, 0)]?.problemId ?? null);
  }, [filteredProblems, hasUnsavedDraft, selectedProblemId]);
  useEffect(() => {
    if (!ticketOpenRequest || openedTicketRequest.current === ticketOpenRequest.sequence) return;
    const problem = problems.find((item) => item.problemId === ticketOpenRequest.problemId);
    if (!problem) {
      if (!loading) {
        openedTicketRequest.current = ticketOpenRequest.sequence;
        showToast(
          'The linked problem is not in the current Relay snapshot. Check its Dynatrace history.',
          'info',
        );
      }
      return;
    }
    openedTicketRequest.current = ticketOpenRequest.sequence;
    const openFilter = isProblemAddressed(stateByProblemId.get(problem.problemId), problem)
      ? 'addressed'
      : 'unaddressed';
    setFilter(problem.status === 'CLOSED' ? 'resolved' : openFilter);
    setHistoryPreferences((current) => ({ ...current, responseFilter: 'all' }));
    setQuery('');
    setSelectedProblemId(problem.problemId);
  }, [ticketOpenRequest, problems, stateByProblemId, loading, showToast]);
  const handleOpenDynatrace = useCallback(
    async (problem: DynatraceProblemRecord) => {
      const url = buildDynatraceProblemUrl(problem.environmentUrl, problem.problemId);
      if (!url || !(await globalThis.api?.openExternal(url))) {
        showToast(
          formatFailure({
            what: `Couldn't open ${problem.displayId} in Dynatrace`,
            next: `Search for ${problem.displayId} in Dynatrace in your browser.`,
          }),
          'error',
        );
      }
    },
    [showToast],
  );
  const handleCopyTicket = useCallback(
    async (reference: string) => {
      if (await globalThis.api?.writeClipboard(reference)) {
        showToast(`Copied Service Desk reference ${reference}`, 'success');
      } else {
        showToast(
          formatFailure({
            what: "Couldn't copy the Service Desk reference",
            outcome: 'Your clipboard is unchanged.',
            next: `Select and copy ${reference} from the problem details.`,
          }),
          'error',
        );
      }
    },
    [showToast],
  );
  const handleOpenTicket = useCallback(
    async (reference: string) => {
      const url = getSafeTicketUrl(reference);
      if (!url || !(await globalThis.api?.openServiceDeskUrl(url))) {
        showToast(
          formatFailure({
            what: `Couldn't open Service Desk reference ${reference}`,
            next: 'Search for it in Service Desk.',
          }),
          'error',
        );
      }
    },
    [showToast],
  );

  const isWebRuntime = globalThis.api?.runtime?.kind === 'web';
  const canManageWebSettings =
    privilegedSession.state === 'active' &&
    privilegedSession.capabilities.includes('settings.manage');
  const canConfigureSync = relayMode === 'server' && (!isWebRuntime || canManageWebSettings);
  const canSyncDynatrace = canConfigureSync && sync?.state !== 'disabled';

  const handleRefresh = async () => {
    if (savingAction) return;
    await runExclusive('refresh', async () => {
      try {
        if (canSyncDynatrace) {
          const result = await globalThis.api?.syncDynatraceProblems();
          if (result && !result.success) throw new Error(result.error || 'Dynatrace sync failed.');
        }
        await refetch();
      } catch (refreshError) {
        showToast(
          formatFailure({
            what: "Couldn't refresh Dynatrace problems",
            error: refreshError,
            outcome: 'The queue shows the last problems Relay received.',
          }),
          'error',
        );
      }
    });
  };

  if (loading && problems.length === 0) return <TabFallback />;

  const refreshControl = refreshControlCopy(canSyncDynatrace, savingAction === 'refresh');

  return (
    <div className="dt-problems">
      <TabPageHeader title="Problems" subtitle="Dynatrace NOC response" />

      <TabCommandBar ariaLabel="Problem queue actions">
        <TabCommandGroup kind="utility" className="dt-problems__toolbar">
          {/* Refresh then its freshness lead the bar, as on Status and Radar; the queue's view
              strip and its search follow. */}
          <div className="dt-problems__sync">
            <TactileButton
              variant="secondary"
              className="dt-problems__refresh"
              onClick={() => void handleRefresh()}
              disabled={savingAction === 'refresh'}
              aria-label={refreshControl.label}
              tooltip={refreshControl.tooltip}
              icon={
                <svg
                  className={
                    savingAction === 'refresh' ? 'dt-problems__refresh-icon--spinning' : ''
                  }
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
                </svg>
              }
            >
              {refreshControl.text}
            </TactileButton>
            <TabFreshness
              at={sync?.lastSuccessAt}
              stale={sync?.state === 'disabled' || sync?.state === 'error'}
              label="Last successful sync"
            />
          </div>
          <fieldset className="dt-problems__filters tab-strip" aria-label="Problem queue filters">
            {PROBLEM_FILTERS.map((item, index) => (
              <Tooltip
                key={item.id}
                content={`${item.label}${query.trim() ? ' matching the current search' : ''} (Alt+${index + 1})`}
              >
                <button
                  type="button"
                  aria-pressed={filter === item.id}
                  aria-keyshortcuts={`Alt+${index + 1}`}
                  className="dt-problems__filter tab-strip__tab"
                  onClick={() => setFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <span className="tab-strip__count">{filterCounts[item.id]}</span>
                </button>
              </Tooltip>
            ))}
          </fieldset>
          <div className="dt-problems__search scoped-search-control">
            <SearchInput
              ref={searchInputRef}
              type="search"
              aria-label="Search problems"
              aria-keyshortcuts="/"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, ID, or entity"
              className="scoped-search-input"
            />
          </div>
        </TabCommandGroup>
      </TabCommandBar>

      {/* Sync notices are not live: the queue's persistent sync status (QueueSyncAnnouncer)
          announces sync failing and the result limit. Rail and pip mark severity by shape. */}
      {sync?.state === 'error' && (
        <div
          className="dt-problems__notice dt-problems__notice--error panel-error ink-rail ink-rail--alarm"
          role="note"
        >
          <strong>Dynatrace sync needs attention.</strong>
          <span>{sync.error || 'Relay could not refresh the problem feed.'}</span>
          {sync.nextRetryAt && (
            <span>Next automatic retry {formatExactDateTime(sync.nextRetryAt)}.</span>
          )}
        </div>
      )}
      {(sync?.nocPendingCount ?? 0) > 0 && (
        <div
          className="dt-problems__notice dt-problems__notice--warning ink-rail ink-rail--warning"
          role="note"
        >
          <strong>
            {sync?.nocPendingCount === 1
              ? '1 NOC update waiting to sync'
              : `${sync?.nocPendingCount} NOC updates waiting to sync`}
          </strong>
          <span>{sync?.nocSyncError || 'Relay sends them to Dynatrace on the next poll.'}</span>
        </div>
      )}
      {!sync?.nocPendingCount && sync?.nocSyncError && (
        <div
          className="dt-problems__notice dt-problems__notice--warning ink-rail ink-rail--warning"
          role="note"
        >
          <strong>Shared NOC notes need attention.</strong>
          <span>{sync.nocSyncError}</span>
        </div>
      )}
      {sync?.resultTruncated && (
        <div
          className="dt-problems__notice dt-problems__notice--warning ink-rail ink-rail--warning"
          role="note"
        >
          <strong>Dynatrace result limit reached.</strong>
          <span>Relay history may be incomplete until the query limit or scope is adjusted.</span>
        </div>
      )}
      {error && (
        <div
          className="dt-problems__notice dt-problems__notice--error panel-error ink-rail ink-rail--alarm"
          role="alert"
        >
          <strong>Relay could not load the complete local problem queue.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="dt-problems__workspace">
        <span className="sr-only" aria-live="polite">
          {selectedProblem
            ? 'Selected problem ' + getDynatraceProblemDisplayTitle(selectedProblem)
            : 'No problem selected'}
        </span>
        <ProblemQueue
          problems={filteredProblems}
          states={stateByProblemId}
          responseSummaries={responseSummaries}
          selectedProblemId={selectedProblemId}
          sync={sync}
          totalProblemCount={problems.length}
          totalHistoryCount={counts.resolved}
          loadedHistoryCount={counts.loadedHistory}
          historyCachedPartial={historyCachedPartial}
          hasMoreHistory={hasMoreHistory}
          loadingMoreHistory={loadingMoreHistory}
          historyScopeCount={historyScopeCount}
          historyMode={filter === 'resolved'}
          historySort={historySort}
          historyResponseFilter={historyResponseFilter}
          onHistorySortChange={handleHistorySortChange}
          queueSort={queueSort}
          onQueueSortChange={handleQueueSortChange}
          onHistoryResponseFilterChange={handleHistoryResponseFilterChange}
          onLoadMoreHistory={() => void loadMoreHistory()}
          onSelect={setSelectedProblemId}
          query={query}
          onClearSearch={() => {
            setQuery('');
            searchInputRef.current?.focus();
          }}
          canConfigureSync={canConfigureSync}
        />
        <ProblemDetail
          problem={selectedProblem}
          state={selectedState}
          notes={selectedNotes}
          hasPendingDispositionResponse={hasPendingDispositionResponse}
          resolverDraft={resolverDraft}
          resolvers={resolvers}
          resolverError={resolverError}
          resolverSelectRef={resolverSelectRef}
          noteDraft={noteDraft}
          connectionState={connectionState}
          savingAction={savingAction}
          noteInputRef={noteInputRef}
          primaryActionRef={primaryActionRef}
          onNoteDraftChange={setNoteDraft}
          onResolverDraftChange={setResolverDraft}
          onSaveResponse={() => void handleSaveResponse()}
          onAddressToggle={() => void handleAddressToggle()}
          onOpenDynatrace={(problem) => void handleOpenDynatrace(problem)}
          onCopyTicket={(reference) => void handleCopyTicket(reference)}
          onOpenTicket={(reference) => void handleOpenTicket(reference)}
          onEditNote={editNote}
          onDeleteNote={deleteNote}
        />
      </div>

      {/* The Unaddressed count already sits on the filter tab and the sidebar state line, so the
        footer carries only the shared connection state. */}
      <StatusBar left={<StatusBarLive />} />
    </div>
  );
};
