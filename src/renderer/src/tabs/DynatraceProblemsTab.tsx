import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  buildDynatraceProblemUrl,
  DYNATRACE_PROBLEM_RESOLVERS,
  getDynatraceProblemDisplayTitle,
  type DynatraceEntityRef,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemRecord,
  type DynatraceProblemResolver,
  type DynatraceProblemSeverity,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { normalizeServiceDeskUrl } from '@shared/urlSecurity';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { TactileButton } from '../components/TactileButton';
import { useToast } from '../components/Toast';
import { SearchInput } from '../components/SearchInput';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { useDynatraceProblems } from '../hooks/useDynatraceProblems';
import { useDynatraceProblemShortcuts } from '../hooks/useDynatraceProblemShortcuts';
import {
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  parseDynatraceTicketReferenceNote,
} from '../services/dynatraceProblemsService';
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
  writeHistoryPreferences,
  type HistoryPreferences,
  type HistoryResponseFilter,
  type HistorySort,
  type ProblemFilter,
  type ProblemResponseSummary,
} from './dynatraceProblemQueueModel';
import {
  useProblemDispositionWorkflow,
  type ProblemSavingAction,
} from './useProblemDispositionWorkflow';
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

function ProblemResponseMetadata({
  summary,
}: Readonly<{ summary: ProblemResponseSummary | undefined }>) {
  if (!summary?.hasLocalResponse) {
    return (
      <span className="dt-problem-row__local-response dt-problem-row__local-response--empty">
        No local response
      </span>
    );
  }

  const hasResponder = Boolean(summary.responder);
  const hasNotes = summary.nocNoteCount > 0;
  const ticketReference = summary.ticketReferences[0];

  if (!hasResponder && !hasNotes && !ticketReference) {
    return <span className="dt-problem-row__local-response">Addressed locally</span>;
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
          <span className="dt-problem-row__response-ticket" title={ticketReference}>
            {ticketReference}
          </span>
        </span>
      )}
    </span>
  );
}

function getLastSyncLabel(sync: DynatraceProblemSyncRecord | null): string {
  if (sync?.state === 'disabled') return 'Sync disabled';
  if (sync?.state === 'syncing') return 'Syncing now';
  if (sync?.state === 'error' && sync.lastSuccessAt) {
    return `Sync failed · last success ${timeAgo(sync.lastSuccessAt)}`;
  }
  if (sync?.lastSuccessAt) return `Synced ${timeAgo(sync.lastSuccessAt)}`;
  return 'Not yet synced';
}

function getAddressActionLabel(saving: boolean, addressed: boolean): string {
  if (saving) return 'Saving…';
  return addressed ? 'Return to queue' : 'Mark addressed locally';
}

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
    return 'Dynatrace resolved this problem before Relay recorded a local addressed status.';
  }
  if (responseRequirementMet && resolverRequirementMet) {
    return 'Response ready. Mark addressed when the local work is complete.';
  }
  return 'Choose your name, then add a ticket or note below.';
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
  onHistoryResponseFilterChange: (filter: HistoryResponseFilter) => void;
  onLoadMoreHistory: () => void;
  onSelect: (problemId: string) => void;
};

type ProblemQueueRowProps = {
  problems: DynatraceProblemRecord[];
  states: Map<string, DynatraceProblemStateRecord>;
  responseSummaries: Map<string, ProblemResponseSummary>;
  selectedProblemId: string | null;
  historyMode: boolean;
  onSelect: (problemId: string) => void;
};

const PROBLEM_QUEUE_ROW_HEIGHT = 124;

function emptyQueueCopy(
  integrationDisabled: boolean,
  historyMode: boolean,
  historyResponseFilter: HistoryResponseFilter,
  historyScopeCount: number,
  totalHistoryCount: number,
): { title: string; description: string } {
  if (integrationDisabled) {
    return {
      title: 'Dynatrace Problems is not configured',
      description: 'Configure the read-only integration in Settings on the Relay server.',
    };
  }
  if (historyMode && historyResponseFilter !== 'all' && historyScopeCount > 0) {
    return {
      title: 'No history matches this response filter',
      description: 'Choose another response filter to see the remaining resolved problems.',
    };
  }
  if (historyMode && totalHistoryCount === 0) {
    return {
      title: 'No resolved problems in the one-year history',
      description: 'Resolved problems will remain here with their local notes and disposition.',
    };
  }
  return {
    title: 'No problems match this queue',
    description: 'Try another filter or clear the search.',
  };
}

function refreshControlCopy(
  canSyncDynatrace: boolean,
  refreshing: boolean,
): { label: string; tooltip: string } {
  const label = canSyncDynatrace
    ? 'Sync Dynatrace problems and alerting profiles now'
    : 'Reload Relay problem data';
  if (!refreshing) return { label, tooltip: label };
  return {
    label,
    tooltip: canSyncDynatrace
      ? 'Syncing Dynatrace problems and alerting profiles'
      : 'Reloading Relay problem data',
  };
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
  const { problems, states, responseSummaries, selectedProblemId, historyMode, onSelect } = data;
  const problem = problems[index];
  if (!problem) return null;
  const addressed = isProblemAddressed(states.get(problem.problemId));
  const responseSummary = responseSummaries.get(problem.problemId);
  const selected = problem.problemId === selectedProblemId;
  const tone = problem.status === 'CLOSED' ? 'resolved' : severityTone(problem.severity);
  const statusLabel = problem.status === 'CLOSED' ? 'Resolved' : severityLabel(problem.severity);
  const primaryEntity = getPrimaryEntity(problem);
  const alertingProfile = problem.alertingProfiles?.[0];

  return (
    <div style={style} {...ariaAttributes}>
      <button
        type="button"
        className={`dt-problem-row${selected ? ' dt-problem-row--selected' : ''}`}
        onClick={() => onSelect(problem.problemId)}
        aria-pressed={selected}
      >
        <span className={`dt-problem-row__signal dt-problem-row__signal--${tone}`} />
        <span className="dt-problem-row__content">
          <span className="dt-problem-row__topline">
            <span className={`dt-problem-badge dt-problem-badge--${tone}`}>{statusLabel}</span>
            {addressed && (
              <span className="dt-problem-badge dt-problem-badge--addressed">
                Addressed locally
              </span>
            )}
            <span className="dt-problem-row__time">{formatDuration(problem)}</span>
          </span>
          <span className="dt-problem-row__title">{getDynatraceProblemDisplayTitle(problem)}</span>
          {historyMode ? (
            <ProblemResponseMetadata summary={responseSummary} />
          ) : (
            primaryEntity && (
              <span className="dt-problem-row__entity-context">
                <span>{primaryEntity.kind}</span>
                <strong title={primaryEntity.name}>{primaryEntity.name}</strong>
                {primaryEntity.additionalCount > 0 && (
                  <small>+{primaryEntity.additionalCount}</small>
                )}
              </span>
            )
          )}
          <span className="dt-problem-row__meta">
            <span>{problem.displayId || problem.problemId}</span>
            <span>{alertingProfile || problem.impactLevel.toLowerCase()}</span>
            <time
              dateTime={toDateTimeAttribute(problem.startTime)}
              title={formatExactDateTime(problem.startTime)}
            >
              {formatDateTime(problem.startTime)}
            </time>
          </span>
        </span>
      </button>
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
  onHistoryResponseFilterChange,
  onLoadMoreHistory,
  onSelect,
}: Readonly<ProblemQueueProps>) {
  const rowProps = useMemo<ProblemQueueRowProps>(
    () => ({
      problems,
      states,
      responseSummaries,
      selectedProblemId,
      historyMode,
      onSelect,
    }),
    [historyMode, onSelect, problems, responseSummaries, selectedProblemId, states],
  );
  let queueContents: React.ReactNode;
  if (problems.length === 0) {
    const integrationDisabled = sync?.state === 'disabled' && totalProblemCount === 0;
    const { title, description } = emptyQueueCopy(
      integrationDisabled,
      historyMode,
      historyResponseFilter,
      historyScopeCount,
      totalHistoryCount,
    );
    queueContents = (
      <div className="dt-problems__empty">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    );
  } else {
    queueContents = (
      <div className="dt-problems__queue-list">
        <AutoSizer
          renderProp={({ height, width }) => (
            <List
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
    ? `${problems.length.toLocaleString()} shown · ${loadedHistoryCount.toLocaleString()} of ${totalHistoryCount.toLocaleString()} ${historyAvailability}`
    : `${problems.length.toLocaleString()} shown`;

  return (
    <section
      className="dt-problems__queue"
      aria-label={historyMode ? 'Dynatrace problem history' : 'Dynatrace problem queue'}
    >
      <div className="dt-problems__section-heading">
        <div className="dt-problems__section-heading-copy">
          <span>{historyMode ? 'History' : 'Problem queue'}</span>
          <small>
            {historyMode ? (
              <>Resolved problems are retained for one year.</>
            ) : (
              <>
                <kbd>Alt+↑/↓</kbd> move · <kbd>Alt+N</kbd> note
              </>
            )}
          </small>
        </div>
        <span
          role={historyMode ? 'status' : undefined}
          aria-live={historyMode ? 'polite' : undefined}
          aria-atomic={historyMode ? 'true' : undefined}
        >
          {problemCountLabel}
        </span>
      </div>
      {historyMode && (
        <div className="dt-problems__history-controls" aria-label="History organization controls">
          <label className="dt-problems__history-control">
            <span>Sort</span>
            <select
              aria-label="Sort history"
              value={historySort}
              onChange={(event) => onHistorySortChange(event.target.value as HistorySort)}
            >
              <option value="newest">Newest first</option>
              <option value="addressed-first">Locally addressed first</option>
              <option value="response-first">Local response first</option>
              <option value="no-response-first">No local response first</option>
            </select>
          </label>
          <label className="dt-problems__history-control">
            <span>Response</span>
            <select
              aria-label="Filter history by response"
              value={historyResponseFilter}
              onChange={(event) =>
                onHistoryResponseFilterChange(event.target.value as HistoryResponseFilter)
              }
            >
              <option value="all">All responses</option>
              <option value="local-response">Has local response</option>
              <option value="addressed">Addressed locally</option>
              <option value="notes">Has NOC notes</option>
              <option value="tickets">Has ticket</option>
              <option value="none">No local response</option>
            </select>
          </label>
        </div>
      )}
      {queueContents}
      {historyMode && hasMoreHistory && (
        <div className="dt-problems__history-pagination">
          <button type="button" onClick={onLoadMoreHistory} disabled={loadingMoreHistory}>
            {loadingMoreHistory ? 'Loading…' : 'Load 100 more'}
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
  resolverDraft: DynatraceProblemResolver | '';
  ticketDraft: string;
  noteDraft: string;
  connectionState: ConnectionState;
  savingAction: ProblemSavingAction;
  noteInputRef: RefObject<HTMLTextAreaElement | null>;
  onTicketDraftChange: (value: string) => void;
  onNoteDraftChange: (value: string) => void;
  onResolverDraftChange: (value: DynatraceProblemResolver | '') => void;
  onSaveResponse: () => void;
  onAddressToggle: () => void;
  onOpenDynatrace: (problem: DynatraceProblemRecord) => void;
  onCopyTicket: (reference: string) => void;
  onOpenTicket: (reference: string) => void;
};

type ProblemResolverSelectProps = {
  label: string;
  value: DynatraceProblemResolver | '';
  disabled: boolean;
  onChange: (value: DynatraceProblemResolver | '') => void;
};

function ProblemResolverSelect({
  label,
  value,
  disabled,
  onChange,
}: Readonly<ProblemResolverSelectProps>) {
  return (
    <label className="dt-problem-resolver">
      <span>{label}</span>
      <select
        name="dynatrace-problem-resolver"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value as DynatraceProblemResolver | '')}
        disabled={disabled}
        required
      >
        <option value="" disabled>
          Select your name
        </option>
        {DYNATRACE_PROBLEM_RESOLVERS.map((resolver) => (
          <option key={resolver} value={resolver}>
            {resolver}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProblemDetail({
  problem,
  state,
  notes,
  hasPendingDispositionResponse,
  resolverDraft,
  ticketDraft,
  noteDraft,
  connectionState,
  savingAction,
  noteInputRef,
  onTicketDraftChange,
  onNoteDraftChange,
  onResolverDraftChange,
  onSaveResponse,
  onAddressToggle,
  onOpenDynatrace,
  onCopyTicket,
  onOpenTicket,
}: Readonly<ProblemDetailProps>) {
  if (!problem) {
    return (
      <section className="dt-problems__detail" aria-label="Selected problem details">
        <div className="dt-problems__empty dt-problems__empty--detail">
          <strong>Select a problem</strong>
          <span>Problem context, local disposition, and response history will appear here.</span>
        </div>
      </section>
    );
  }

  const addressed = isProblemAddressed(state);
  const mutationsEnabled = connectionState === 'online' || connectionState === 'offline';
  const hasDraftedResponse = ticketDraft.trim().length > 0 || noteDraft.trim().length > 0;
  const responseRequirementMet = hasDraftedResponse || hasPendingDispositionResponse;
  const resolverRequirementMet = resolverDraft.length > 0;
  const tone = problem.status === 'CLOSED' ? 'resolved' : severityTone(problem.severity);
  const statusLabel =
    problem.status === 'CLOSED' ? 'Resolved by Dynatrace' : severityLabel(problem.severity);
  const resolved = problem.status === 'CLOSED';
  const canComposeResponse = !addressed || resolved;
  const dispositionDetail = getDispositionDetail(
    addressed,
    responseRequirementMet,
    resolverRequirementMet,
    state,
    resolved,
  );
  const addressActionLabel = getAddressActionLabel(savingAction === 'address', addressed);
  let dispositionTitle = 'Needs local response';
  if (addressed) dispositionTitle = 'Addressed locally';
  else if (resolved) dispositionTitle = 'No local disposition recorded';

  const displayTitle = getDynatraceProblemDisplayTitle(problem);
  const hasDistinctWorkflowTitle = Boolean(
    problem.workflowTitle?.trim() && problem.workflowTitle.trim() !== problem.title.trim(),
  );
  const hasWorkflowContext = Boolean(
    hasDistinctWorkflowTitle ||
    problem.workflowDescription?.trim() ||
    problem.workflowTags?.length ||
    problem.workflowAffectedEntityTypes?.length,
  );
  return (
    <section className="dt-problems__detail" aria-label="Selected problem details">
      <div className="dt-problem-detail">
        <header className="dt-problem-detail__header">
          <div className="dt-problem-detail__badges">
            <span className={`dt-problem-badge dt-problem-badge--${tone}`}>{statusLabel}</span>
            {addressed && (
              <span className="dt-problem-badge dt-problem-badge--addressed">
                Addressed locally
              </span>
            )}
          </div>
          <h3>{displayTitle}</h3>
          <div className="dt-problem-detail__identity">
            <span>{problem.displayId || problem.problemId}</span>
            <span>
              Started{' '}
              <time
                dateTime={toDateTimeAttribute(problem.startTime)}
                title={formatExactDateTime(problem.startTime)}
              >
                {formatDateTime(problem.startTime)}
              </time>
            </span>
            <span>Duration {formatDuration(problem)}</span>
          </div>
        </header>

        <div className="dt-problem-detail__facts">
          <div>
            <span>Impact</span>
            <strong>{problem.impactLevel.toLowerCase()}</strong>
          </div>
          <div>
            <span>Root cause</span>
            <strong>{problem.rootCauseName || 'Not identified'}</strong>
          </div>
          <div>
            <span>Alerting profile</span>
            <strong title={(problem.alertingProfiles ?? []).join(', ')}>
              {(problem.alertingProfiles ?? []).join(', ') || 'Not assigned'}
            </strong>
          </div>
        </div>
        {hasWorkflowContext && (
          <div className="dt-problem-detail__section dt-problem-detail__workflow-context">
            <div className="dt-problem-detail__section-title">NOC workflow context</div>
            {problem.workflowDescription && (
              <p className="dt-problem-detail__workflow-description">
                {problem.workflowDescription}
              </p>
            )}
            <dl className="dt-problem-detail__workflow-metadata">
              {hasDistinctWorkflowTitle && (
                <div>
                  <dt>Canonical problem</dt>
                  <dd>{problem.title}</dd>
                </div>
              )}
              {(problem.workflowTags?.length ?? 0) > 0 && (
                <div>
                  <dt>Workflow tags</dt>
                  <dd className="dt-problem-detail__workflow-values">
                    {problem.workflowTags?.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </dd>
                </div>
              )}
              {(problem.workflowAffectedEntityTypes?.length ?? 0) > 0 && (
                <div>
                  <dt>Affected types</dt>
                  <dd className="dt-problem-detail__workflow-values">
                    {problem.workflowAffectedEntityTypes?.map((type) => (
                      <span key={type}>{type.toLowerCase()}</span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="dt-problem-detail__section">
          <div className="dt-problem-detail__section-title">Affected entities</div>
          <EntityList entities={problem.affectedEntities} />
        </div>

        <div className="dt-problem-detail__section">
          <div className="dt-problem-detail__section-title">Impacted entities</div>
          <EntityList entities={problem.impactedEntities} />
        </div>

        <div className="dt-problem-detail__response">
          <div className="dt-problem-detail__response-copy">
            <span>Local NOC disposition</span>
            <strong>{dispositionTitle}</strong>
            <small id="dt-problem-note-requirement">{dispositionDetail}</small>
          </div>
          {!resolved && (
            <div className="dt-problem-detail__response-actions">
              {!addressed && (
                <ProblemResolverSelect
                  label="Resolved by"
                  value={resolverDraft}
                  onChange={onResolverDraftChange}
                  disabled={!mutationsEnabled || savingAction !== null}
                />
              )}
              <button
                type="button"
                className={`dt-problems__primary-action${
                  addressed ? ' dt-problems__primary-action--secondary' : ''
                }`}
                onClick={onAddressToggle}
                disabled={
                  !mutationsEnabled ||
                  savingAction !== null ||
                  (!addressed && (!responseRequirementMet || !resolverRequirementMet))
                }
                aria-describedby={!addressed ? 'dt-problem-note-requirement' : undefined}
              >
                {addressActionLabel}
              </button>
            </div>
          )}
        </div>

        <div className="dt-problem-detail__section dt-problem-detail__notes">
          <div className="dt-problem-detail__section-title">
            <span>Local response history</span>
            <span>{notes.length}</span>
          </div>
          {canComposeResponse && (
            <>
              {resolved && (
                <ProblemResolverSelect
                  label="Response by"
                  value={resolverDraft}
                  onChange={onResolverDraftChange}
                  disabled={!mutationsEnabled || savingAction !== null}
                />
              )}
              <div className="dt-problem-ticket-composer">
                <label htmlFor="dt-problem-ticket-number">Service Desk ticket number</label>
                <div className="dt-problem-ticket-composer__control">
                  <input
                    id="dt-problem-ticket-number"
                    name="dynatrace-problem-ticket"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={ticketDraft}
                    onChange={(event) => onTicketDraftChange(event.target.value)}
                    maxLength={MAX_DYNATRACE_TICKET_REFERENCE_LENGTH}
                    disabled={!mutationsEnabled || savingAction !== null}
                    placeholder="INC, REQ, CHG, or other ticket number"
                  />
                </div>
                <small>
                  Relay records the ticket number for notation only. It does not create or update a
                  Service Desk ticket. Enter a full HTTPS ticket link to also get an
                  &ldquo;Open&rdquo; action on the saved reference.
                </small>
              </div>
              <label className="dt-problem-note-composer">
                <span>Add a note</span>
                <textarea
                  ref={noteInputRef}
                  name="dynatrace-problem-note"
                  autoComplete="off"
                  value={noteDraft}
                  onChange={(event) => onNoteDraftChange(event.target.value)}
                  placeholder="Record investigation details, mitigation, ownership, or next steps"
                  maxLength={5_000}
                  disabled={!mutationsEnabled || savingAction !== null}
                />
              </label>
              <div className="dt-problem-note-composer__actions">
                <span>{noteDraft.length.toLocaleString()} / 5,000</span>
                {resolved && (
                  <button
                    type="button"
                    onClick={onSaveResponse}
                    disabled={
                      !mutationsEnabled ||
                      !hasDraftedResponse ||
                      !resolverRequirementMet ||
                      savingAction !== null
                    }
                  >
                    {savingAction === 'response' ? 'Saving…' : 'Save response'}
                  </button>
                )}
              </div>
              {connectionState === 'offline' && (
                <div className="dt-problems__offline-note">
                  You are offline. Changes will sync when Relay reconnects.
                </div>
              )}
              {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
                <div className="dt-problems__offline-note">
                  Relay is reconnecting. Wait for the connection to settle before changing local
                  status or adding notes.
                </div>
              )}
              {connectionState === 'auth-failed' && (
                <div className="dt-problems__offline-note">
                  Sign in to the Relay server before changing local status or adding notes.
                </div>
              )}
            </>
          )}
          <div className="dt-problem-notes" aria-live="polite">
            {notes.length === 0 ? (
              <div className="dt-problem-notes__empty">
                No local response history yet. Add a ticket reference or response context.
              </div>
            ) : (
              [...notes].reverse().map((note) => {
                const ticketReference = parseDynatraceTicketReferenceNote(note.note);
                return (
                  <article className="dt-problem-note" key={note.id}>
                    <div className="dt-problem-note__meta">
                      <strong>{note.author || 'Unattributed'}</strong>
                      <time
                        dateTime={toDateTimeAttribute(note.created)}
                        title={formatExactDateTime(note.created)}
                      >
                        {formatDateTime(note.created)}
                      </time>
                    </div>
                    {ticketReference ? (
                      <div className="dt-problem-note__ticket">
                        <span>Service Desk ticket</span>
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
                              aria-label={`Open ${ticketReference}`}
                              onClick={() => onOpenTicket(ticketReference)}
                            >
                              Open ↗
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p>{note.note}</p>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>

        <footer className="dt-problem-detail__footer">
          <span>Dynatrace ID {problem.problemId}</span>
          <button type="button" onClick={() => onOpenDynatrace(problem)}>
            Open Dynatrace ↗
          </button>
        </footer>
      </div>
    </section>
  );
}

export const DynatraceProblemsTab: React.FC<{
  relayMode?: PublicRelayConfig['mode'];
  active?: boolean;
}> = ({ relayMode, active = true }) => {
  const { showToast } = useToast();
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
    refetch,
  } = useDynatraceProblems();
  const [filter, setFilter] = useState<ProblemFilter>('unaddressed');
  const [query, setQuery] = useState('');
  const [historyPreferences, setHistoryPreferences] =
    useState<HistoryPreferences>(readHistoryPreferences);
  const { sort: historySort, responseFilter: historyResponseFilter } = historyPreferences;
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const lastSelectedProblemIdRef = useRef<string | null>(null);
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

  const { counts, unaddressedProblemIds, responseSummaries, filteredProblems, historyScopeCount } =
    useMemo(
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
        }),
      [
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

  const selectUnaddressedProblem = useCallback((problemId: string) => {
    setFilter('unaddressed');
    setQuery('');
    setSelectedProblemId(problemId);
  }, []);
  const focusSelectedProblemNote = useCallback(() => noteInputRef.current?.focus(), []);
  const reportNoUnaddressedProblems = useCallback(
    () => showToast('No unaddressed Dynatrace problems.', 'info'),
    [showToast],
  );

  useDynatraceProblemShortcuts({
    active,
    unaddressedProblemIds,
    selectedProblemId: selectedProblemId ?? lastSelectedProblemIdRef.current,
    onSelectProblem: selectUnaddressedProblem,
    onFocusNote: focusSelectedProblemNote,
    onNoUnaddressedProblems: reportNoUnaddressedProblems,
  });

  const selectedProblem = problems.find((problem) => problem.problemId === selectedProblemId);
  const selectedState = selectedProblem
    ? stateByProblemId.get(selectedProblem.problemId)
    : undefined;
  const selectedNotes = selectedProblem
    ? (notesByProblemId.get(selectedProblem.problemId) ?? [])
    : [];
  const {
    ticketDraft,
    noteDraft,
    resolverDraft,
    hasUnsavedDraft,
    hasPendingDispositionResponse,
    savingAction,
    setTicketDraft,
    setNoteDraft,
    setResolverDraft,
    handleSaveResponse,
    handleAddressToggle,
    runExclusive,
  } = useProblemDispositionWorkflow({
    selectedProblem,
    selectedState,
    addNote,
    setAddressed,
  });

  useEffect(() => {
    if (filteredProblems.some((problem) => problem.problemId === selectedProblemId)) return;
    // Re-selecting when the current problem falls out of the queue is a convenience and
    // never worth interrupting work for: hold the selection while a response is drafted.
    if (hasUnsavedDraft) return;
    setSelectedProblemId(filteredProblems[0]?.problemId ?? null);
  }, [filteredProblems, hasUnsavedDraft, selectedProblemId]);
  const handleOpenDynatrace = useCallback(
    async (problem: DynatraceProblemRecord) => {
      const url = buildDynatraceProblemUrl(problem.environmentUrl, problem.problemId);
      if (!url || !(await globalThis.api?.openExternal(url))) {
        showToast('Unable to open this problem in Dynatrace.', 'error');
      }
    },
    [showToast],
  );
  const handleCopyTicket = useCallback(
    async (reference: string) => {
      if (await globalThis.api?.writeClipboard(reference)) {
        showToast('Service Desk reference copied', 'success');
      } else {
        showToast('Unable to copy the Service Desk reference.', 'error');
      }
    },
    [showToast],
  );
  const handleOpenTicket = useCallback(
    async (reference: string) => {
      const url = getSafeTicketUrl(reference);
      if (!url || !(await globalThis.api?.openServiceDeskUrl(url))) {
        showToast('Unable to open the Service Desk reference.', 'error');
      }
    },
    [showToast],
  );

  const handleRefresh = async () => {
    if (savingAction) return;
    await runExclusive('refresh', async () => {
      try {
        const canSyncDynatrace = relayMode === 'server' && globalThis.api?.runtime?.kind !== 'web';
        if (canSyncDynatrace && sync?.state !== 'disabled') {
          const result = await globalThis.api?.syncDynatraceProblems();
          if (result && !result.success) throw new Error(result.error || 'Dynatrace sync failed.');
        }
        await refetch();
      } catch (refreshError) {
        showToast(
          refreshError instanceof Error ? refreshError.message : 'Failed to refresh problems',
          'error',
        );
      }
    });
  };

  if (loading && problems.length === 0) return <TabFallback />;

  const lastSyncLabel = getLastSyncLabel(sync);
  const canSyncDynatrace = relayMode === 'server' && globalThis.api?.runtime?.kind !== 'web';
  const refreshControl = refreshControlCopy(canSyncDynatrace, savingAction === 'refresh');

  return (
    <div className="dt-problems">
      <TabPageHeader
        context="Dynatrace Problems"
        title="Local Response Queue"
        metadata={
          <span
            className={`dt-problems__sync-state dt-problems__sync-state--${sync?.state ?? 'disabled'}`}
            role="status"
            aria-live="polite"
            title={sync?.lastSuccessAt ? formatExactDateTime(sync.lastSuccessAt) : undefined}
          >
            {lastSyncLabel}
          </span>
        }
      />

      <TabCommandBar ariaLabel="Problem queue actions">
        <TabCommandGroup kind="utility" className="dt-problems__toolbar">
          <fieldset className="dt-problems__filters" aria-label="Problem queue filters">
            {PROBLEM_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                className={`dt-problems__filter${filter === item.id ? ' dt-problems__filter--active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span>
                <span className="dt-problems__filter-count">{counts[item.id]}</span>
              </button>
            ))}
          </fieldset>
          <div className="dt-problems__tools">
            <div className="dt-problems__search scoped-search-control">
              <SearchInput
                type="search"
                aria-label="Search problems"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, ID, entity, or profile"
                className="scoped-search-input"
              />
            </div>
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
            />
          </div>
        </TabCommandGroup>
      </TabCommandBar>

      {sync?.state === 'error' && (
        <div className="dt-problems__notice dt-problems__notice--error" role="alert">
          <strong>Dynatrace sync needs attention.</strong>
          <span>{sync.error || 'Relay could not refresh the problem feed.'}</span>
          {sync.nextRetryAt && (
            <span>Next automatic retry {formatExactDateTime(sync.nextRetryAt)}.</span>
          )}
        </div>
      )}
      {sync?.resultTruncated && (
        <div className="dt-problems__notice dt-problems__notice--warning" role="alert">
          <strong>Dynatrace result limit reached.</strong>
          <span>Relay history may be incomplete until the query limit or scope is adjusted.</span>
        </div>
      )}
      {error && (
        <div className="dt-problems__notice dt-problems__notice--error" role="alert">
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
          onHistoryResponseFilterChange={handleHistoryResponseFilterChange}
          onLoadMoreHistory={() => void loadMoreHistory()}
          onSelect={setSelectedProblemId}
        />
        <ProblemDetail
          problem={selectedProblem}
          state={selectedState}
          notes={selectedNotes}
          hasPendingDispositionResponse={hasPendingDispositionResponse}
          resolverDraft={resolverDraft}
          ticketDraft={ticketDraft}
          noteDraft={noteDraft}
          connectionState={connectionState}
          savingAction={savingAction}
          noteInputRef={noteInputRef}
          onTicketDraftChange={setTicketDraft}
          onNoteDraftChange={setNoteDraft}
          onResolverDraftChange={setResolverDraft}
          onSaveResponse={() => void handleSaveResponse()}
          onAddressToggle={() => void handleAddressToggle()}
          onOpenDynatrace={(problem) => void handleOpenDynatrace(problem)}
          onCopyTicket={(reference) => void handleCopyTicket(reference)}
          onOpenTicket={(reference) => void handleOpenTicket(reference)}
        />
      </div>

      <StatusBar
        left={<StatusBarLive />}
        center={<span>{lastSyncLabel}</span>}
        right={<span>{counts.unaddressed} need local response</span>}
      />
    </div>
  );
};
