import { useEffect, useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpReview } from '@shared/sdpMutation';
import type {
  SdpRelatedTicket,
  SdpTicketRelations,
  SdpRelationMutation,
} from '@shared/sdpTicketRelations';
import { TactileButton } from '../../components/TactileButton';
const operationTitles = { merge: 'Merge tickets', unlink: 'Unlink tickets', link: 'Link tickets' };
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    value: SdpReview;
    target: SdpRelatedTicket;
    operation: SdpRelationMutation['operation'];
  }>();
  const [finished, setFinished] = useState(false);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setData(undefined);
    setReview(undefined);
    setFinished(false);
    setPage(0);
    setMessage('');
    if (enabled) {
      setBusy(true);
      void globalThis.api!.sdpAccount!({ action: 'readTicketRelations', id: ticket.id, page: 0 })
        .then((r) => {
          if (generation.current !== current) return;
          if (r.success && r.data?.ticketRelations) setData(r.data.ticketRelations);
          else setMessage('Could not load linked tickets. Refresh and try again.');
        })
        .catch(() => {
          if (generation.current === current) setMessage('Could not load linked tickets.');
        })
        .finally(() => {
          if (generation.current === current) setBusy(false);
        });
    }
    return () => {
      generation.current = current + 1;
    };
  }, [ticket.id, enabled]);
  async function run(work: () => Promise<void>) {
    if (locked.current || !enabled) return;
    const current = generation.current;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      if (current === generation.current)
        setMessage(e instanceof Error ? e.message : 'Could not complete this operation.');
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
        setMessage('No accessible ticket matches that number.');
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
      setMessage(r.data.message ?? 'Check SDP for the result.');
      onResult(r.data);
    });
  }
  if (!enabled) return <p>Connect to live SDP to manage linked tickets.</p>;
  const candidate = data?.candidate;
  return (
    <section aria-label="SDP linked tickets" className="sdp-native-editor">
      <h4>SDP tickets</h4>
      <p className="ticket-mode-note">
        Link related tickets, or merge a duplicate into this ticket.
      </p>
      {message && (
        <p>
          <output>{message}</output>
        </p>
      )}
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
          <TactileButton disabled={busy} onClick={() => void confirm()}>
            Confirm {review.operation}
          </TactileButton>
          <TactileButton
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
        </section>
      ) : (
        !finished && (
          <>
            {!data?.linked.length && data && <p>No linked tickets.</p>}
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
                <TactileButton disabled={busy} onClick={() => void load(page - 1)}>
                  Previous linked tickets
                </TactileButton>
              )}
              {data?.hasMore && (
                <TactileButton disabled={busy} onClick={() => void load(page + 1)}>
                  More linked tickets
                </TactileButton>
              )}
            </div>
            {(data?.canLink || data?.canMerge) && (
              <details className="sdp-disclosure">
                <summary>Link or merge a ticket</summary>
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
                  disabled={busy || !number.trim()}
                  onClick={() => void load(0, number.trim())}
                >
                  Find ticket
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
                            disabled={busy}
                            onClick={() => void prepare('link', candidate)}
                          >
                            Link ticket
                          </TactileButton>
                        )}
                        {data.canMerge && (
                          <TactileButton
                            disabled={busy}
                            onClick={() => void prepare('merge', candidate)}
                          >
                            Merge duplicate into {ticket.number}
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
