import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  buildDynatraceProblemUrl,
  DYNATRACE_PROBLEM_RESOLVERS,
  type DynatraceEntityRef,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemRecord,
  type DynatraceProblemResolver,
  type DynatraceProblemSeverity,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { Modal } from '../components/Modal';
import { TabFallback } from '../components/TabFallback';
import { TactileButton } from '../components/TactileButton';
import { useToast } from '../components/Toast';
import { SearchInput } from '../components/SearchInput';
import { useDynatraceProblems } from '../hooks/useDynatraceProblems';
import {
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  formatDynatraceTicketReferenceNote,
  parseDynatraceTicketReferenceNote,
} from '../services/dynatraceProblemsService';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';
import './dynatrace-problems.css';

type ProblemFilter = 'unaddressed' | 'addressed' | 'resolved';
type HistorySort = 'newest' | 'addressed-first' | 'response-first' | 'no-response-first';
type HistoryResponseFilter = 'all' | 'local-response' | 'addressed' | 'notes' | 'tickets' | 'none';

type ProblemResponseSummary = {
  addressed: boolean;
  hasLocalResponse: boolean;
  nocNoteCount: number;
  responder: string;
  ticketReferences: string[];
};

type HistoryPreferences = {
  sort: HistorySort;
  responseFilter: HistoryResponseFilter;
};

const FILTERS: Array<{ id: ProblemFilter; label: string }> = [
  { id: 'unaddressed', label: 'Unaddressed' },
  { id: 'addressed', label: 'Addressed locally' },
  { id: 'resolved', label: 'History' },
];

const HISTORY_PREFERENCES_STORAGE_KEY = 'relay-dynatrace-history-preferences';
const DEFAULT_HISTORY_PREFERENCES: HistoryPreferences = {
  sort: 'newest',
  responseFilter: 'all',
};
const EMPTY_RESPONSE_SUMMARY: ProblemResponseSummary = {
  addressed: false,
  hasLocalResponse: false,
  nocNoteCount: 0,
  responder: '',
  ticketReferences: [],
};
const HISTORY_SORTS = new Set<HistorySort>([
  'newest',
  'addressed-first',
  'response-first',
  'no-response-first',
]);
const HISTORY_RESPONSE_FILTERS = new Set<HistoryResponseFilter>([
  'all',
  'local-response',
  'addressed',
  'notes',
  'tickets',
  'none',
]);

function readHistoryPreferences(): HistoryPreferences {
  try {
    const stored = globalThis.localStorage?.getItem(HISTORY_PREFERENCES_STORAGE_KEY);
    if (!stored) return DEFAULT_HISTORY_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<HistoryPreferences>;
    return {
      sort:
        typeof parsed.sort === 'string' && HISTORY_SORTS.has(parsed.sort as HistorySort)
          ? (parsed.sort as HistorySort)
          : DEFAULT_HISTORY_PREFERENCES.sort,
      responseFilter:
        typeof parsed.responseFilter === 'string' &&
        HISTORY_RESPONSE_FILTERS.has(parsed.responseFilter as HistoryResponseFilter)
          ? (parsed.responseFilter as HistoryResponseFilter)
          : DEFAULT_HISTORY_PREFERENCES.responseFilter,
    };
  } catch {
    return DEFAULT_HISTORY_PREFERENCES;
  }
}

function writeHistoryPreferences(preferences: HistoryPreferences): void {
  try {
    globalThis.localStorage?.setItem(HISTORY_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preference persistence is best-effort; History remains fully usable without it.
  }
}

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

function formatDateTime(value: number | string | undefined): string {
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

function isAddressed(state: DynatraceProblemStateRecord | undefined): boolean {
  return state?.addressed === true;
}

function matchesFilter(
  problem: DynatraceProblemRecord,
  state: DynatraceProblemStateRecord | undefined,
  filter: ProblemFilter,
): boolean {
  if (filter === 'resolved') return problem.status === 'CLOSED';
  if (problem.status !== 'OPEN') return false;
  return filter === 'addressed' ? isAddressed(state) : !isAddressed(state);
}

function searchableText(problem: DynatraceProblemRecord): string {
  return [
    problem.title,
    problem.displayId,
    problem.problemId,
    problem.rootCauseName,
    ...problem.affectedEntities.flatMap((entity) => [entity.name, entity.id, entity.type]),
    ...problem.impactedEntities.flatMap((entity) => [entity.name, entity.id, entity.type]),
    ...problem.managementZones.map((zone) => zone.name),
    ...(problem.alertingProfiles ?? []),
  ]
    .join(' ')
    .toLowerCase();
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

function problemSort(a: DynatraceProblemRecord, b: DynatraceProblemRecord): number {
  return b.startTime - a.startTime;
}

function summarizeProblemResponse(
  state: DynatraceProblemStateRecord | undefined,
  notes: DynatraceProblemNoteRecord[],
): ProblemResponseSummary {
  const ticketReferenceTimes = new Map<string, number>();
  let nocNoteCount = 0;
  let latestAttributedNote: DynatraceProblemNoteRecord | undefined;

  for (const note of notes) {
    const ticketReference = parseDynatraceTicketReferenceNote(note.note);
    if (ticketReference) {
      const createdAt = new Date(note.created).getTime();
      const timestamp = Number.isFinite(createdAt) ? createdAt : 0;
      const previousTimestamp = ticketReferenceTimes.get(ticketReference);
      if (previousTimestamp === undefined || timestamp >= previousTimestamp) {
        ticketReferenceTimes.set(ticketReference, timestamp);
      }
    } else {
      nocNoteCount += 1;
    }
    if (
      note.author?.trim() &&
      (!latestAttributedNote ||
        new Date(note.created).getTime() >= new Date(latestAttributedNote.created).getTime())
    ) {
      latestAttributedNote = note;
    }
  }

  const addressed = isAddressed(state);
  return {
    addressed,
    hasLocalResponse: addressed || notes.length > 0,
    nocNoteCount,
    responder: state?.addressedBy?.trim() || latestAttributedNote?.author?.trim() || '',
    ticketReferences: [...ticketReferenceTimes]
      .sort(([, aTimestamp], [, bTimestamp]) => bTimestamp - aTimestamp)
      .map(([reference]) => reference),
  };
}

function matchesHistoryResponseFilter(
  summary: ProblemResponseSummary,
  responseFilter: HistoryResponseFilter,
): boolean {
  switch (responseFilter) {
    case 'local-response':
      return summary.hasLocalResponse;
    case 'addressed':
      return summary.addressed;
    case 'notes':
      return summary.nocNoteCount > 0;
    case 'tickets':
      return summary.ticketReferences.length > 0;
    case 'none':
      return !summary.hasLocalResponse;
    default:
      return true;
  }
}

function historyProblemSort(
  a: DynatraceProblemRecord,
  b: DynatraceProblemRecord,
  sort: HistorySort,
  responseSummaries: Map<string, ProblemResponseSummary>,
): number {
  const aSummary = responseSummaries.get(a.problemId);
  const bSummary = responseSummaries.get(b.problemId);
  let aRank = 0;
  let bRank = 0;

  if (sort === 'addressed-first') {
    aRank = aSummary?.addressed ? 0 : 1;
    bRank = bSummary?.addressed ? 0 : 1;
  } else if (sort === 'response-first') {
    aRank = aSummary?.hasLocalResponse ? 0 : 1;
    bRank = bSummary?.hasLocalResponse ? 0 : 1;
  } else if (sort === 'no-response-first') {
    aRank = aSummary?.hasLocalResponse ? 1 : 0;
    bRank = bSummary?.hasLocalResponse ? 1 : 0;
  }

  return aRank - bRank || problemSort(a, b);
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
  if (sync?.lastSuccessAt) return `Synced ${timeAgo(sync.lastSuccessAt)}`;
  if (sync?.state === 'syncing') return 'Syncing now';
  return 'Not yet synced';
}

function getAddressActionLabel(saving: boolean, addressed: boolean): string {
  if (saving) return 'Saving…';
  return addressed ? 'Return to queue' : 'Mark addressed locally';
}

type AlertingProfilePickerProps = {
  profiles: string[];
  selectedProfiles: string[];
  filterConfigured: boolean;
  canSave: boolean;
  saving: boolean;
  onChange: (profiles: string[]) => void;
  onCancel: () => void;
  onSave: () => Promise<boolean>;
};

function AlertingProfilePicker({
  profiles,
  selectedProfiles,
  filterConfigured,
  canSave,
  saving,
  onChange,
  onCancel,
  onSave,
}: Readonly<AlertingProfilePickerProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedProfiles), [selectedProfiles]);
  const visibleProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? profiles.filter((profile) => profile.toLowerCase().includes(normalizedQuery))
      : profiles;
  }, [profiles, query]);

  const closeWithoutSaving = useCallback(() => {
    setOpen(false);
    setQuery('');
    onCancel();
  }, [onCancel]);

  const toggleProfile = (profile: string) => {
    const next = new Set(selected);
    if (next.has(profile)) next.delete(profile);
    else next.add(profile);
    onChange(profiles.filter((candidate) => next.has(candidate)));
  };

  const triggerLabel = filterConfigured
    ? `${selectedProfiles.length} retained`
    : 'Choose retained profiles';

  return (
    <>
      <button
        type="button"
        className={`dt-problems__profile-trigger${filterConfigured ? ' dt-problems__profile-trigger--configured' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={profiles.length === 0}
      >
        <span>Alerting profiles</span>
        <strong>{profiles.length === 0 ? 'Catalog loading' : triggerLabel}</strong>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <Modal
        isOpen={open}
        onClose={closeWithoutSaving}
        title="Alerting profile filter"
        subtitle={`${profiles.length} available from Dynatrace`}
        variant="standard"
        bodyClassName="dt-profile-picker"
        footer={
          canSave ? (
            <>
              <TactileButton variant="secondary" onClick={closeWithoutSaving} disabled={saving}>
                Cancel
              </TactileButton>
              <TactileButton
                variant="primary"
                disabled={selectedProfiles.length === 0 || saving}
                loading={saving}
                onClick={() => void onSave().then((saved) => saved && setOpen(false))}
              >
                Save retention filter
              </TactileButton>
            </>
          ) : undefined
        }
      >
        <label className="dt-profile-picker__search">
          <span className="sr-only">Search alerting profiles</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an alerting profile"
            autoFocus
          />
        </label>
        <div className="dt-profile-picker__bulk-actions">
          <button type="button" onClick={() => onChange(profiles)} disabled={!canSave}>
            Select all
          </button>
          <button type="button" onClick={() => onChange([])} disabled={!canSave}>
            Clear
          </button>
          <span>{selectedProfiles.length} selected</span>
        </div>
        <div className="dt-profile-picker__list" role="group" aria-label="Alerting profiles">
          {visibleProfiles.map((profile) => (
            <label className="dt-profile-picker__option" key={profile}>
              <input
                type="checkbox"
                checked={selected.has(profile)}
                onChange={() => toggleProfile(profile)}
                disabled={!canSave}
              />
              <span>{profile}</span>
            </label>
          ))}
          {visibleProfiles.length === 0 && (
            <div className="dt-profile-picker__empty">No profiles match this search.</div>
          )}
        </div>
        <div className="dt-profile-picker__retention-note">
          {canSave
            ? 'Saving removes excluded problem records, local dispositions, and notes from Relay.'
            : 'Profile retention is managed on the Relay server.'}
        </div>
      </Modal>
    </>
  );
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
  historyScopeCount: number;
  historyMode: boolean;
  historySort: HistorySort;
  historyResponseFilter: HistoryResponseFilter;
  onHistorySortChange: (sort: HistorySort) => void;
  onHistoryResponseFilterChange: (filter: HistoryResponseFilter) => void;
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
  const addressed = isAddressed(states.get(problem.problemId));
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
          <span className="dt-problem-row__title">{problem.title}</span>
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
            <span>{formatDateTime(problem.startTime)}</span>
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
  historyScopeCount,
  historyMode,
  historySort,
  historyResponseFilter,
  onHistorySortChange,
  onHistoryResponseFilterChange,
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
    let emptyTitle = 'No problems match this queue';
    let emptyDescription = 'Try another filter or clear the search.';
    if (integrationDisabled) {
      emptyTitle = 'Dynatrace Problems is not configured';
      emptyDescription = 'Configure the read-only integration in Settings on the Relay server.';
    } else if (historyMode && historyResponseFilter !== 'all' && historyScopeCount > 0) {
      emptyTitle = 'No history matches this response filter';
      emptyDescription = 'Choose another response filter to see the remaining resolved problems.';
    } else if (historyMode && totalHistoryCount === 0) {
      emptyTitle = 'No resolved problems in the one-year history';
      emptyDescription =
        'Resolved problems will remain here with their local notes and disposition.';
    }
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
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
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

  return (
    <section
      className="dt-problems__queue"
      aria-label={historyMode ? 'Dynatrace problem history' : 'Dynatrace problem queue'}
    >
      <div className="dt-problems__section-heading">
        <div className="dt-problems__section-heading-copy">
          <span>{historyMode ? 'History' : 'Problem queue'}</span>
          {historyMode && <small>Resolved problems are retained for one year.</small>}
        </div>
        <span
          role={historyMode ? 'status' : undefined}
          aria-live={historyMode ? 'polite' : undefined}
          aria-atomic={historyMode ? 'true' : undefined}
        >
          {problems.length} shown
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
    </section>
  );
}

type ProblemSavingAction = 'address' | 'response' | 'refresh' | 'profile' | null;

type PendingDispositionResponse = {
  noteId: string;
  resolver: DynatraceProblemResolver;
};

/** The unsaved local response an operator is composing for one problem. */
type ProblemDraft = {
  ticket: string;
  note: string;
  resolver: DynatraceProblemResolver | '';
};

const EMPTY_PROBLEM_DRAFT: ProblemDraft = { ticket: '', note: '', resolver: '' };

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
  onTicketDraftChange: (value: string) => void;
  onNoteDraftChange: (value: string) => void;
  onResolverDraftChange: (value: DynatraceProblemResolver | '') => void;
  onSaveResponse: () => void;
  onAddressToggle: () => void;
  onOpenDynatrace: (problem: DynatraceProblemRecord) => void;
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
  onTicketDraftChange,
  onNoteDraftChange,
  onResolverDraftChange,
  onSaveResponse,
  onAddressToggle,
  onOpenDynatrace,
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

  const addressed = isAddressed(state);
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
          <h3>{problem.title}</h3>
          <div className="dt-problem-detail__identity">
            <span>{problem.displayId || problem.problemId}</span>
            <span>Started {formatDateTime(problem.startTime)}</span>
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
            <span>Management zones</span>
            <strong>{problem.managementZones.map((zone) => zone.name).join(', ') || 'None'}</strong>
          </div>
          <div>
            <span>Alerting profile</span>
            <strong title={(problem.alertingProfiles ?? []).join(', ')}>
              {(problem.alertingProfiles ?? []).join(', ') || 'Not assigned'}
            </strong>
          </div>
        </div>

        <div className="dt-problem-detail__section">
          <div className="dt-problem-detail__section-title">Affected entities</div>
          <EntityList entities={problem.affectedEntities} />
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
                  Service Desk ticket.
                </small>
              </div>
              <label className="dt-problem-note-composer">
                <span>Add a note</span>
                <textarea
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
                      <span>{formatDateTime(note.created)}</span>
                    </div>
                    {ticketReference ? (
                      <div className="dt-problem-note__ticket">
                        <span>Service Desk ticket</span>
                        <strong>{ticketReference}</strong>
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
}> = ({ relayMode }) => {
  const { showToast } = useToast();
  const {
    problems,
    stateByProblemId,
    notesByProblemId,
    sync,
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
  const [profileDraft, setProfileDraft] = useState<string[]>([]);
  const [profileDraftDirty, setProfileDraftDirty] = useState(false);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  // Drafts are keyed by problem so an in-progress NOC note survives anything that moves
  // the selection — a keystroke in the search box, or a background sync flipping the
  // problem to CLOSED and pushing it out of the open queues. Losing that text mid-incident
  // is unrecoverable; it exists nowhere else until it is saved.
  const [draftsByProblemId, setDraftsByProblemId] = useState<Record<string, ProblemDraft>>({});
  const [pendingDispositionResponses, setPendingDispositionResponses] = useState<
    Record<string, PendingDispositionResponse>
  >({});
  const [savingAction, setSavingAction] = useState<ProblemSavingAction>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => onConnectionStateChange(setConnectionState), []);

  useEffect(() => {
    writeHistoryPreferences(historyPreferences);
  }, [historyPreferences]);

  const handleHistorySortChange = useCallback((sort: HistorySort) => {
    setHistoryPreferences((current) => ({ ...current, sort }));
  }, []);

  const handleHistoryResponseFilterChange = useCallback((responseFilter: HistoryResponseFilter) => {
    setHistoryPreferences((current) => ({ ...current, responseFilter }));
  }, []);

  const counts = useMemo(() => {
    let unaddressed = 0;
    let addressed = 0;
    let resolved = 0;
    for (const problem of problems) {
      if (problem.status === 'CLOSED') resolved += 1;
      else if (isAddressed(stateByProblemId.get(problem.problemId))) addressed += 1;
      else unaddressed += 1;
    }
    return { unaddressed, addressed, resolved };
  }, [problems, stateByProblemId]);

  const alertingProfiles = useMemo(() => {
    const profiles = [
      ...(sync?.availableAlertingProfiles ?? []),
      ...(sync?.selectedAlertingProfiles ?? []),
      ...problems.flatMap((problem) => problem.alertingProfiles ?? []),
    ];
    return [...new Set(profiles)].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [problems, sync?.availableAlertingProfiles, sync?.selectedAlertingProfiles]);
  const profileFilterConfigured = sync?.profileFilterConfigured === true;
  const savedProfiles = useMemo(
    () => (profileFilterConfigured ? (sync?.selectedAlertingProfiles ?? []) : alertingProfiles),
    [alertingProfiles, profileFilterConfigured, sync?.selectedAlertingProfiles],
  );

  useEffect(() => {
    if (!profileDraftDirty) setProfileDraft(savedProfiles);
  }, [profileDraftDirty, savedProfiles]);

  const responseSummaries = useMemo(() => {
    const summaries = new Map<string, ProblemResponseSummary>();
    for (const problem of problems) {
      summaries.set(
        problem.problemId,
        summarizeProblemResponse(
          stateByProblemId.get(problem.problemId),
          notesByProblemId.get(problem.problemId) ?? [],
        ),
      );
    }
    return summaries;
  }, [notesByProblemId, problems, stateByProblemId]);

  const { filteredProblems, historyScopeCount } = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const scopedProblems = problems
      .filter((problem) => matchesFilter(problem, stateByProblemId.get(problem.problemId), filter))
      .filter((problem) => {
        if (!profileFilterConfigured && !profileDraftDirty) return true;
        return problem.alertingProfiles.some((profile) => profileDraft.includes(profile));
      })
      .filter((problem) => !normalizedQuery || searchableText(problem).includes(normalizedQuery));
    const visibleProblems = scopedProblems
      .filter(
        (problem) =>
          filter !== 'resolved' ||
          matchesHistoryResponseFilter(
            responseSummaries.get(problem.problemId) ?? EMPTY_RESPONSE_SUMMARY,
            historyResponseFilter,
          ),
      )
      .sort((a, b) =>
        filter === 'resolved'
          ? historyProblemSort(a, b, historySort, responseSummaries)
          : problemSort(a, b),
      );
    return {
      filteredProblems: visibleProblems,
      historyScopeCount: filter === 'resolved' ? scopedProblems.length : 0,
    };
  }, [
    filter,
    historyResponseFilter,
    historySort,
    problems,
    profileDraft,
    profileDraftDirty,
    profileFilterConfigured,
    query,
    responseSummaries,
    stateByProblemId,
  ]);

  const {
    ticket: ticketDraft,
    note: noteDraft,
    resolver: resolverDraft,
  } = selectedProblemId
    ? (draftsByProblemId[selectedProblemId] ?? EMPTY_PROBLEM_DRAFT)
    : EMPTY_PROBLEM_DRAFT;
  const hasUnsavedDraft =
    ticketDraft.trim().length > 0 || noteDraft.trim().length > 0 || resolverDraft.length > 0;

  const updateSelectedDraft = useCallback(
    (patch: Partial<ProblemDraft>) => {
      if (!selectedProblemId) return;
      setDraftsByProblemId((current) => ({
        ...current,
        [selectedProblemId]: { ...(current[selectedProblemId] ?? EMPTY_PROBLEM_DRAFT), ...patch },
      }));
    },
    [selectedProblemId],
  );
  const setTicketDraft = useCallback(
    (value: string) => updateSelectedDraft({ ticket: value }),
    [updateSelectedDraft],
  );
  const setNoteDraft = useCallback(
    (value: string) => updateSelectedDraft({ note: value }),
    [updateSelectedDraft],
  );
  const setResolverDraft = useCallback(
    (value: DynatraceProblemResolver | '') => updateSelectedDraft({ resolver: value }),
    [updateSelectedDraft],
  );

  useEffect(() => {
    if (filteredProblems.some((problem) => problem.problemId === selectedProblemId)) return;
    // Re-selecting when the current problem falls out of the queue is a convenience and
    // never worth interrupting work for: hold the selection while a response is drafted.
    if (hasUnsavedDraft) return;
    setSelectedProblemId(filteredProblems[0]?.problemId ?? null);
  }, [filteredProblems, hasUnsavedDraft, selectedProblemId]);

  const selectedProblem = problems.find((problem) => problem.problemId === selectedProblemId);
  const selectedState = selectedProblem
    ? stateByProblemId.get(selectedProblem.problemId)
    : undefined;
  const selectedNotes = selectedProblem
    ? (notesByProblemId.get(selectedProblem.problemId) ?? [])
    : [];
  const selectedPendingDispositionResponse = selectedProblem
    ? pendingDispositionResponses[selectedProblem.problemId]
    : undefined;
  const pendingDispositionResponseNoteId =
    selectedPendingDispositionResponse?.resolver === resolverDraft
      ? selectedPendingDispositionResponse.noteId
      : '';
  const addSelectedProblemNote = useCallback(
    (problemId: string, note: string) =>
      resolverDraft ? addNote(problemId, note, resolverDraft) : addNote(problemId, note),
    [addNote, resolverDraft],
  );
  const handleOpenDynatrace = useCallback(
    async (problem: DynatraceProblemRecord) => {
      const url = buildDynatraceProblemUrl(problem.environmentUrl, problem.problemId);
      if (!url || !(await globalThis.api?.openExternal(url))) {
        showToast('Unable to open this problem in Dynatrace.', 'error');
      }
    },
    [showToast],
  );

  const saveDraftedResponses = async (
    problemId: string,
    onResponsePersisted?: (noteId: string) => void,
  ) => {
    let responseNoteId = '';
    if (ticketDraft.trim()) {
      const ticketNote = await addSelectedProblemNote(
        problemId,
        formatDynatraceTicketReferenceNote(ticketDraft),
      );
      responseNoteId = ticketNote.id;
      if (responseNoteId) onResponsePersisted?.(responseNoteId);
      setTicketDraft('');
    }
    if (noteDraft.trim()) {
      const nocNote = await addSelectedProblemNote(problemId, noteDraft);
      responseNoteId ||= nocNote.id;
      if (responseNoteId) onResponsePersisted?.(responseNoteId);
      setNoteDraft('');
    }
    if (!responseNoteId) {
      throw new Error(
        'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
      );
    }
    return responseNoteId;
  };

  const handleSaveResponse = async () => {
    if (
      !selectedProblem ||
      !resolverDraft ||
      (!ticketDraft.trim() && !noteDraft.trim()) ||
      savingAction
    )
      return;
    setSavingAction('response');
    try {
      await saveDraftedResponses(selectedProblem.problemId);
      showToast('Local response saved', 'success');
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : 'Failed to save local response',
        'error',
      );
    } finally {
      setSavingAction(null);
    }
  };

  const handleAddressToggle = async () => {
    if (!selectedProblem || savingAction) return;
    const nextAddressed = !isAddressed(selectedState);
    if (nextAddressed && !resolverDraft) {
      showToast('Select your name from the resolver list.', 'warning');
      return;
    }
    const hasDraftedResponse = Boolean(ticketDraft.trim() || noteDraft.trim());
    if (nextAddressed && !hasDraftedResponse && !pendingDispositionResponseNoteId) {
      showToast(
        'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
        'warning',
      );
      return;
    }
    setSavingAction('address');
    try {
      let responseNoteId = pendingDispositionResponseNoteId || undefined;
      if (nextAddressed) {
        const resolver = resolverDraft as DynatraceProblemResolver;
        if (hasDraftedResponse) {
          responseNoteId = await saveDraftedResponses(selectedProblem.problemId, (noteId) => {
            setPendingDispositionResponses((current) => ({
              ...current,
              [selectedProblem.problemId]: { noteId, resolver },
            }));
          });
        }
      }
      await setAddressed(
        selectedProblem.problemId,
        nextAddressed,
        responseNoteId,
        nextAddressed ? resolverDraft : undefined,
      );
      setPendingDispositionResponses((current) => {
        if (!current[selectedProblem.problemId]) return current;
        const next = { ...current };
        delete next[selectedProblem.problemId];
        return next;
      });
      setResolverDraft('');
      showToast(
        nextAddressed ? 'Problem marked addressed locally' : 'Problem returned to queue',
        'success',
      );
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : 'Failed to update local problem state',
        'error',
      );
    } finally {
      setSavingAction(null);
    }
  };

  const handleRefresh = async () => {
    if (savingAction) return;
    setSavingAction('refresh');
    try {
      if (relayMode === 'server' && sync?.state !== 'disabled') {
        const result = await globalThis.api?.syncDynatraceProblems();
        if (result && !result.success) throw new Error(result.error || 'Dynatrace sync failed.');
      }
      await refetch();
    } catch (refreshError) {
      showToast(
        refreshError instanceof Error ? refreshError.message : 'Failed to refresh problems',
        'error',
      );
    } finally {
      setSavingAction(null);
    }
  };

  const handleProfileDraftChange = (profiles: string[]) => {
    setProfileDraft(profiles);
    setProfileDraftDirty(true);
  };

  const handleProfileDraftCancel = () => {
    setProfileDraft(savedProfiles);
    setProfileDraftDirty(false);
  };

  const handleSaveProfileFilter = async (): Promise<boolean> => {
    if (relayMode !== 'server') {
      showToast('Save the retained alerting profiles on the Relay server.', 'warning');
      return false;
    }
    if (profileDraft.length === 0 || savingAction) return false;
    setSavingAction('profile');
    try {
      const result = await globalThis.api?.saveDynatraceProblemProfileFilter(profileDraft);
      if (!result?.success || !result.data) {
        throw new Error(result?.error || 'Could not save the alerting profile filter.');
      }
      setProfileDraftDirty(false);
      await refetch();
      showToast(
        `Retention filter saved · ${result.data.count.toLocaleString()} matching problems`,
        'success',
      );
      return true;
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : 'Could not save the profile filter',
        'error',
      );
      return false;
    } finally {
      setSavingAction(null);
    }
  };

  if (loading && problems.length === 0) return <TabFallback />;

  const lastSyncLabel = getLastSyncLabel(sync);

  return (
    <div className="dt-problems">
      <div className="dt-problems__header">
        <div>
          <div className="dt-problems__context">Dynatrace Problems</div>
          <h2 className="dt-problems__title">Local Response Queue</h2>
        </div>
        <div className="dt-problems__sync-meta">
          <span
            className={`dt-problems__sync-state dt-problems__sync-state--${sync?.state ?? 'disabled'}`}
          >
            {lastSyncLabel}
          </span>
          <button
            type="button"
            className="dt-problems__refresh"
            onClick={() => void handleRefresh()}
            disabled={savingAction === 'refresh'}
            aria-label="Refresh Dynatrace Problems"
          >
            <svg
              className={savingAction === 'refresh' ? 'dt-problems__refresh-icon--spinning' : ''}
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
          </button>
        </div>
      </div>

      <div className="dt-problems__toolbar">
        <div className="dt-problems__filters" role="tablist" aria-label="Problem queue filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`dt-problems__filter${filter === item.id ? ' dt-problems__filter--active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              <span>{item.label}</span>
              <span className="dt-problems__filter-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="dt-problems__tools">
          <AlertingProfilePicker
            profiles={alertingProfiles}
            selectedProfiles={profileDraft}
            filterConfigured={profileFilterConfigured}
            canSave={relayMode === 'server'}
            saving={savingAction === 'profile'}
            onChange={handleProfileDraftChange}
            onCancel={handleProfileDraftCancel}
            onSave={handleSaveProfileFilter}
          />
          <div className="dt-problems__search scoped-search-control">
            <SearchInput
              type="search"
              aria-label="Search problems"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, ID, entity, profile, or zone"
              className="scoped-search-input"
            />
          </div>
        </div>
      </div>

      {sync?.state === 'error' && (
        <div className="dt-problems__notice dt-problems__notice--error" role="alert">
          <strong>Dynatrace sync needs attention.</strong>
          <span>{sync.error || 'Relay could not refresh the problem feed.'}</span>
        </div>
      )}
      {error && (
        <div className="dt-problems__notice dt-problems__notice--error" role="alert">
          <strong>Relay could not load the complete local problem queue.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="dt-problems__workspace">
        <ProblemQueue
          problems={filteredProblems}
          states={stateByProblemId}
          responseSummaries={responseSummaries}
          selectedProblemId={selectedProblemId}
          sync={sync}
          totalProblemCount={problems.length}
          totalHistoryCount={counts.resolved}
          historyScopeCount={historyScopeCount}
          historyMode={filter === 'resolved'}
          historySort={historySort}
          historyResponseFilter={historyResponseFilter}
          onHistorySortChange={handleHistorySortChange}
          onHistoryResponseFilterChange={handleHistoryResponseFilterChange}
          onSelect={setSelectedProblemId}
        />
        <ProblemDetail
          problem={selectedProblem}
          state={selectedState}
          notes={selectedNotes}
          hasPendingDispositionResponse={Boolean(pendingDispositionResponseNoteId)}
          resolverDraft={resolverDraft}
          ticketDraft={ticketDraft}
          noteDraft={noteDraft}
          connectionState={connectionState}
          savingAction={savingAction}
          onTicketDraftChange={setTicketDraft}
          onNoteDraftChange={setNoteDraft}
          onResolverDraftChange={setResolverDraft}
          onSaveResponse={() => void handleSaveResponse()}
          onAddressToggle={() => void handleAddressToggle()}
          onOpenDynatrace={(problem) => void handleOpenDynatrace(problem)}
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
