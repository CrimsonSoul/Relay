import { useState } from 'react';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { correlateSdpChanges } from '@shared/sdpChangeCorrelation';
import { sdpChangeUrl } from '@shared/sdpChanges';
import { TactileButton } from '../../components/TactileButton';
import { useSdpChanges } from './useSdpChanges';
import { navigateTicketWorkspace } from './ticketNavigation';
import { formatOpsTime } from '../../utils/opsTime';

function relationshipLabel(
  decision: 'confirmed' | 'dismissed' | undefined,
  confidence: 'automatic' | 'suggested',
): string {
  if (decision === 'dismissed') return 'Dismissed';
  if (decision === 'confirmed') return 'Marked relevant';
  return confidence === 'automatic' ? 'Systems & time match' : 'Possible match';
}

export function SdpProblemChanges({ problem }: Readonly<{ problem: DynatraceProblemRecord }>) {
  const state = useSdpChanges(problem.startTime);
  const [decisions, setDecisions] = useState<Record<string, 'confirmed' | 'dismissed'>>({});
  const matches = correlateSdpChanges(problem, state.changes);
  const checking = state.message.startsWith('Checking');
  // An unavailable check collapses to one status line with its fix inline; there is nothing to
  // disclose until a check succeeds.
  const unavailable = !state.checkedAt && !checking;
  let summaryStatus = 'Checking…';
  if (state.checkedAt) {
    const noun = matches.length === 1 ? 'match' : 'matches';
    summaryStatus = `${matches.length} ${noun}${state.partial ? ' · partial check' : ''}`;
  }
  const keyFor = (id: string, start: number | null) =>
    JSON.stringify([state.session, problem.environmentUrl, problem.problemId, id, start]);
  const decide = (key: string, value: 'confirmed' | 'dismissed') =>
    setDecisions((previous) =>
      Object.fromEntries([...Object.entries(previous).slice(-499), [key, value]]),
    );
  if (unavailable) {
    // One muted sentence says why; the next step sits beside it as a quiet link-style action so
    // it never competes with the NOC response form above.
    const reason = state.needsConnection
      ? 'connect your SDP work account'
      : state.message || 'the check did not complete.';
    return (
      <section className="sdp-problem-changes" aria-label="Related SDP changes">
        <div className="sdp-problem-changes__unavailable">
          <output title={state.needsConnection ? state.message : undefined}>
            Changes unavailable: {reason}
          </output>
          {state.needsConnection ? (
            <button
              type="button"
              className="sdp-problem-changes__action"
              onClick={() => navigateTicketWorkspace({ destination: 'ticket' })}
            >
              Connect in Tickets
            </button>
          ) : (
            <button type="button" className="sdp-problem-changes__action" onClick={state.refresh}>
              Retry
            </button>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="sdp-problem-changes" aria-label="Related SDP changes">
      <details className="sdp-disclosure">
        <summary className="sdp-relationship-summary">
          <span>Possible changes</span>
          <span className="ticket-mode-note">{summaryStatus}</span>
        </summary>
        <p className="ticket-mode-note">
          Matches provide context, not a confirmed cause. Review decisions last for this view only.
        </p>
        {state.message && (
          <p>
            <output>{state.message}</output>
          </p>
        )}
        {state.partial && (
          <p>
            <output>Partial coverage: some changes or system details could not be checked.</output>
          </p>
        )}
        {state.checkedAt && matches.length === 0 && (
          <p>No matching changes found in the checked records.</p>
        )}
        {matches.map(({ change, confidence, reasons }) => {
          const key = keyFor(change.id, change.scheduledStart);
          const decision = decisions[key];
          return (
            <details key={change.id} className="sdp-change-match sdp-disclosure">
              <summary>
                <span>
                  <strong>
                    {change.number} — {change.title}
                  </strong>
                  <span className="sdp-match-confidence">
                    {relationshipLabel(decision, confidence)}
                  </span>
                </span>
              </summary>
              <p>
                {change.status || 'Unknown status'}
                {change.stage ? ` · ${change.stage}` : ''}
              </p>
              {decision !== 'dismissed' && (
                <>
                  <p>
                    Scheduled: {new Date(change.scheduledStart!).toLocaleString()} —{' '}
                    {change.scheduledEnd === null
                      ? 'end not set'
                      : new Date(change.scheduledEnd).toLocaleString()}
                  </p>
                  <ul>
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="ticket-actions">
                <TactileButton
                  size="sm"
                  onClick={() => void globalThis.api?.openExternal(sdpChangeUrl(change.id))}
                >
                  Open {change.number} in SDP
                </TactileButton>
                {decision !== 'confirmed' && (
                  <TactileButton size="sm" onClick={() => decide(key, 'confirmed')}>
                    Mark Relevant
                  </TactileButton>
                )}
                {decision !== 'dismissed' && (
                  <TactileButton size="sm" onClick={() => decide(key, 'dismissed')}>
                    Dismiss
                  </TactileButton>
                )}
                {decision && (
                  <TactileButton
                    size="sm"
                    onClick={() =>
                      setDecisions((previous) => {
                        const next = { ...previous };
                        delete next[key];
                        return next;
                      })
                    }
                  >
                    Reset Decision
                  </TactileButton>
                )}
              </div>
            </details>
          );
        })}
        <div className="ticket-actions">
          <TactileButton size="sm" variant="ghost" onClick={state.refresh}>
            Refresh Changes
          </TactileButton>
          {state.checkedAt && (
            <span className="ticket-mode-note">Checked {formatOpsTime(state.checkedAt)}</span>
          )}
        </div>
      </details>
    </section>
  );
}
