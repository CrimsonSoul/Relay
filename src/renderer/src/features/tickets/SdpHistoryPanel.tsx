import { useEffect, useState } from 'react';
import type { SdpHistory } from '@shared/sdpHistory';
import { TactileButton } from '../../components/TactileButton';
import { Tooltip } from '../../components/Tooltip';
import { formatMessageTime, formatOpsTime } from '../../utils/opsTime';

type HistoryEntry = SdpHistory['entries'][number];
type HistoryChange = HistoryEntry['changes'][number];

const OPERATIONS: Record<string, string> = {
  add: 'Created',
  create: 'Created',
  edit: 'Edited',
  update: 'Edited',
  workflow_instance_created: 'Workflow started',
};
const VERBS: Record<string, string> = {
  add: 'added',
  added: 'added',
  create: 'created',
  created: 'created',
  edit: 'edited',
  update: 'edited',
  updated: 'edited',
  delete: 'deleted',
  deleted: 'deleted',
  remove: 'removed',
};
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** SDP names operations in API words (request_note_add); this reads them as "Note added". */
export function historyOperation(operation: string): string {
  const key = operation.trim().toLowerCase();
  if (!key) return 'Changed';
  if (OPERATIONS[key]) return OPERATIONS[key];
  const words = key
    .replace(/^request_/, '')
    .split(/[_\s]+/)
    .filter(Boolean);
  const verb = VERBS[words.at(-1) ?? ''];
  if (verb && words.length > 1) return sentence(`${words.slice(0, -1).join(' ')} ${verb}`);
  return sentence(words.join(' '));
}
/** SDP's field keys (start_time) read as words (Start time). */
export function historyField(field: string): string {
  return sentence(field.trim().replace(/[_\s]+/g, ' ')) || 'Field';
}
/** SDP writes "-" for a value that was not set. */
const blank = (value: string) => !value.trim() || value.trim() === '-';

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
function dayLabel(at: number | null, now = new Date()): string {
  if (at === null) return 'Time not set';
  const date = new Date(at);
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return (date.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT).format(date);
}
/** Entries arrive newest first; consecutive entries from one day share its heading. */
function byDay(entries: readonly HistoryEntry[]) {
  const days: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    if (days.at(-1)?.label === label) days.at(-1)!.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }
  return days;
}

export function SdpHistoryPanel({ id, enabled }: Readonly<{ id: string; enabled: boolean }>) {
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<SdpHistory>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setError('');
    if (!enabled) return;
    void globalThis.api!.sdpAccount!({ action: 'readHistory', id, page })
      .then((result) => {
        if (!active) return;
        if (result.success && result.data?.history) setHistory(result.data.history);
        else setError('Request history is unavailable. Check your connection and SDP permissions.');
      })
      .catch(() => {
        if (active) setError('Request history could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [id, enabled, page, attempt]);
  const paged = page > 0 || !!history?.hasMore;
  return (
    <section aria-label="Request history" className="ticket-related sdp-history">
      <h4>Request history</h4>
      {!enabled && <p>Connect to SDP and refresh this ticket to read its history.</p>}
      {error && (
        <div className="panel-error ink-rail ink-rail--alarm" role="alert">
          <span>{error}</span>
          <TactileButton size="sm" onClick={() => setAttempt((count) => count + 1)}>
            Try Again
          </TactileButton>
        </div>
      )}
      {enabled && !history && !error && (
        <p>
          <output>Loading history…</output>
        </p>
      )}
      {history && !history.entries.length && <p>No history yet.</p>}
      {history &&
        byDay(history.entries).map((day) => (
          <section key={day.label} className="sdp-history-day" aria-label={day.label}>
            <h5>{day.label}</h5>
            <ol>
              {day.entries.map((entry) => (
                <HistoryItem key={entry.id} entry={entry} />
              ))}
            </ol>
          </section>
        ))}
      {paged && (
        <div className="ticket-actions">
          <TactileButton
            size="sm"
            variant="ghost"
            disabled={!history || page === 0}
            onClick={() => setPage(page - 1)}
          >
            Newer History
          </TactileButton>
          <TactileButton
            size="sm"
            variant="ghost"
            disabled={!history?.hasMore || page >= 999}
            onClick={() => setPage(page + 1)}
          >
            Older History
          </TactileButton>
        </div>
      )}
    </section>
  );
}

function HistoryItem({ entry }: Readonly<{ entry: HistoryEntry }>) {
  return (
    <li className="sdp-history-entry">
      <div className="sdp-history-heading">
        <h6>{historyOperation(entry.operation)}</h6>
        <span>{entry.author || 'Unknown user'}</span>
        {entry.at !== null && (
          <Tooltip content={formatMessageTime(entry.at)}>
            <time dateTime={new Date(entry.at).toISOString()}>{formatOpsTime(entry.at)}</time>
          </Tooltip>
        )}
      </div>
      {entry.description && <p className="sdp-history-description">{entry.description}</p>}
      {!!entry.changes.length && (
        <dl className="sdp-history-changes">
          {entry.changes.map((change, index) => (
            <div key={`${change.field}-${index}`}>
              <dt>{historyField(change.field)}</dt>
              <dd>
                <ChangeValue change={change} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** A set value shows alone, a cleared one says so, and a change reads old → new. */
function ChangeValue({ change }: Readonly<{ change: HistoryChange }>) {
  if (blank(change.before)) return <span className="sdp-history-after">{change.after}</span>;
  if (blank(change.after))
    return (
      <>
        <span className="sdp-history-after">Cleared</span>{' '}
        <span className="sdp-history-before">(was {change.before})</span>
      </>
    );
  return (
    <>
      <span className="sdp-history-before">{change.before}</span>
      <span className="sdp-history-arrow"> → </span>
      <span className="sdp-history-after">{change.after}</span>
    </>
  );
}
