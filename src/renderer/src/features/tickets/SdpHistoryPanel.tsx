import { useEffect, useState } from 'react';
import type { SdpHistory } from '@shared/sdpHistory';
import { TactileButton } from '../../components/TactileButton';
export function SdpHistoryPanel({ id, enabled }: Readonly<{ id: string; enabled: boolean }>) {
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<SdpHistory>();
  const [error, setError] = useState('');
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
  }, [id, enabled, page]);
  return (
    <section aria-label="Request history" className="ticket-related">
      <h4>Request history</h4>
      {!enabled && <p>Connect to SDP and refresh this ticket to read its history.</p>}
      {error && <p role="alert">{error}</p>}
      {enabled && !history && !error && (
        <p>
          <output>Loading history…</output>
        </p>
      )}
      {history?.entries.map((entry) => (
        <article key={entry.id} className="sdp-resource-row">
          <h4>
            {entry.operation} · {entry.author || 'Unknown user'}
          </h4>
          {entry.at !== null && (
            <time dateTime={new Date(entry.at).toISOString()}>
              {new Date(entry.at).toLocaleString()}
            </time>
          )}
          {entry.description && <p>{entry.description}</p>}
          <dl>
            {entry.changes.map((change, index) => (
              <div key={`${change.field}-${index}`}>
                <dt>{change.field}</dt>
                <dd>
                  {change.before || 'Not set'} → {change.after || 'Not set'}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
      {history && !history.entries.length && <p>No history entries.</p>}
      <div className="ticket-actions">
        <TactileButton
          size="sm"
          disabled={!history || page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous history
        </TactileButton>
        <TactileButton
          size="sm"
          disabled={!history?.hasMore || page >= 999}
          onClick={() => setPage(page + 1)}
        >
          Next history
        </TactileButton>
      </div>
    </section>
  );
}
