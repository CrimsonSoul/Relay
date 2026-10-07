import { useEffect, useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpReview } from '@shared/sdpMutation';
import type {
  SdpRelatedTicket,
  SdpTicketRelations,
  SdpRelationMutation,
} from '@shared/sdpTicketRelations';
import { TactileButton } from '../../components/TactileButton';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
const operationTitles = { merge: 'Merge tickets', unlink: 'Unlink tickets', link: 'Link tickets' };
const confirmLabels = { merge: 'Confirm Merge', unlink: 'Confirm Unlink', link: 'Confirm Link' };
function describeChange(
  operation: SdpRelationMutation['operation'],
  source: string,
  target: string,
) {
  if (operation === 'merge')
    return `Merge ${target} into ${source}. ${source} remains the main ticket; the other ticket becomes part of its conversation. This cannot be undone here.`;
  const verb = operation === 'link' ? 'Link' : 'Unlink';
  return `${verb} ${target} and ${source}. Both tickets remain separate.`;
}

export function SdpTicketRelationsPanel({
  ticket,
  enabled,
  onResult,
}: Readonly<{
  ticket: SdpQueueTicket;
  enabled: boolean;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [data, setData] = useState<SdpTicketRelations>();
  const [number, setNumber] = useState('');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<SdpNotice>();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    value: SdpReview;
    target: SdpRelatedTicket;
    operation: SdpRelationMutation['operation'];
  }>();
  const [finished, setFinished] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setData(undefined);
    setReview(undefined);
    setFinished(false);
    setPage(0);
    setMessage(undefined);
    setLoadFailed(false);
    if (enabled) {
      setBusy(true);
      void globalThis.api!.sdpAccount!({ action: 'readTicketRelations', id: ticket.id, page: 0 })
        .then((r) => {
          if (generation.current !== current) return;
          if (!r.success || !r.data?.ticketRelations) throw new Error('Relations unavailable.');
          setData(r.data.ticketRelations);
        })
        .catch(() => {
          if (generation.current !== current) return;
          setMessage(sdpError('Could not load linked tickets.'));
          setLoadFailed(true);
        })
        .finally(() => {
          if (generation.current === current) setBusy(false);
        });
    }
    return () => {
      generation.current = current + 1;
    };
  }, [ticket.id, enabled, attempt]);
  async function run(work: () => Promise<void>) {
    if (locked.current || !enabled) return;
    const current = generation.current;
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await work();
    } catch (e) {
      if (current === generation.current)
        setMessage(sdpError(e instanceof Error ? e.message : 'Could not complete this operation.'));
    } finally {
      locked.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  function load(nextPage: number, search?: string) {
    return run(async () => {
      const current = generation.current;
      if (search && !/^(?:[A-Za-z]+-)?\d{1,30}$/.test(search))
        throw new Error('Enter a ticket number, such as IN-1049.');
      const r = await globalThis.api!.sdpAccount!({
        action: 'readTicketRelations',
        id: ticket.id,
        page: nextPage,
        ...(search ? { number: search } : {}),
      });
      if (current !== generation.current) return;
      if (!r.success || !r.data?.ticketRelations) throw new Error('Could not load tickets.');
      setData(r.data.ticketRelations);
      setPage(nextPage);
      if (search && !r.data.ticketRelations.candidate)
        setMessage(sdpInfo('No accessible ticket matches that number.'));
    });
  }
  function prepare(operation: SdpRelationMutation['operation'], target: SdpRelatedTicket) {
    return run(async () => {
      const current = generation.current;
      const r = await globalThis.api!.sdpAccount!({
        action: 'prepareChange',
        mutation: { kind: 'relation', id: ticket.id, targetId: target.id, operation },
      });
      if (current !== generation.current) return;
      if (!r.success || !r.data?.review)
        throw new Error(
          r.data?.message ??
            'Could not prepare this change. Refresh the tickets and check your permissions.',
        );
      setReview({ value: r.data.review, target, operation });
    });
  }
  function confirm() {
    if (!review) return;
    const confirmationId = review.value.confirmationId;
    setReview(undefined);
    return run(async () => {
      const current = generation.current;
      // Consume the review before submission; an uncertain response must never be replayed.
      setFinished(true);
      const r = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (current !== generation.current) return;
      if (!r.success || !r.data)
        throw new Error('Result uncertain. Check SDP before trying again.');
      setMessage(sdpInfo(r.data.message ?? 'Check SDP for the result.'));
      onResult(r.data);
    });
  }
  if (!enabled) return <p>Connect to live SDP to manage linked tickets.</p>;
  const candidate = data?.candidate;
  return (
    <section aria-label="SDP linked tickets" className="ticket-related">
      <h4>SDP tickets</h4>
      <p className="ticket-mode-note">
        Link related tickets, or merge a duplicate into this ticket.
      </p>
      <SdpMessage
        message={message}
        action={
          loadFailed &&
          !busy && (
            <TactileButton size="sm" onClick={() => setAttempt((value) => value + 1)}>
              Try Again
            </TactileButton>
          )
        }
      />
      {busy && (
        <p>
          <output>Working…</output>
        </p>
      )}
      {review ? (
        <section aria-label="Review ticket relationship">
          <h4>{operationTitles[review.operation]}</h4>
          <p>
            {review.target.number}: {review.target.subject}
          </p>
          <p>{describeChange(review.operation, ticket.number, review.target.number)}</p>
          <div className="ticket-actions">
            <TactileButton
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await globalThis.api!.sdpAccount!({ action: 'cancelChange' });
                  setReview(undefined);
                })
              }
            >
              Cancel
            </TactileButton>
            <TactileButton
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {confirmLabels[review.operation]}
            </TactileButton>
          </div>
        </section>
      ) : (
        !finished && (
          <>
            {!data?.linked.length && data && <p className="ticket-mode-note">No linked tickets.</p>}
            <ul>
              {data?.linked.map((t) => (
                <li key={t.id}>
                  {t.number}: {t.subject}{' '}
                  {data.canUnlink && (
                    <TactileButton
                      size="sm"
                      disabled={busy}
                      onClick={() => void prepare('unlink', t)}
                    >
                      Unlink {t.number}
                    </TactileButton>
                  )}
                </li>
              ))}
            </ul>
            <div className="ticket-actions">
              {page > 0 && (
                <TactileButton size="sm" disabled={busy} onClick={() => void load(page - 1)}>
                  Previous Linked Tickets
                </TactileButton>
              )}
              {data?.hasMore && (
                <TactileButton size="sm" disabled={busy} onClick={() => void load(page + 1)}>
                  More Linked Tickets
                </TactileButton>
              )}
            </div>
            {(data?.canLink || data?.canMerge) && (
              <details className="sdp-disclosure">
                <summary>Link or Merge a Ticket</summary>
                <label>
                  <span>Ticket number</span>
                  <input
                    value={number}
                    disabled={busy}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="IN-1049"
                  />
                </label>
                <TactileButton
                  size="sm"
                  disabled={busy || !number.trim()}
                  onClick={() => void load(0, number.trim())}
                >
                  Find Ticket
                </TactileButton>
                {candidate && (
                  <div>
                    <p>
                      {candidate.number}: {candidate.subject}
                    </p>
                    {candidate.id === ticket.id ? (
                      <p>Choose a different ticket.</p>
                    ) : (
                      <div className="ticket-actions">
                        {data.canLink && (
                          <TactileButton
                            size="sm"
                            disabled={busy}
                            onClick={() => void prepare('link', candidate)}
                          >
                            Link Ticket
                          </TactileButton>
                        )}
                        {data.canMerge && (
                          <TactileButton
                            size="sm"
                            disabled={busy}
                            onClick={() => void prepare('merge', candidate)}
                          >
                            Merge Duplicate Into {ticket.number}
                          </TactileButton>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </details>
            )}
          </>
        )
      )}
    </section>
  );
}
