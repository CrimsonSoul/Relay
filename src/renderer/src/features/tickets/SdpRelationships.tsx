import { useState } from 'react';
import type { BridgeGroup } from '@shared/ipc';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import {
  SDP_LINK_COLLECTION,
  sdpTicketUrl,
  type SdpLink,
  type SdpBridgeContext,
} from '@shared/sdpLinks';
import { useCollection } from '../../hooks/useCollection';
import { linkSdpProblem, unlinkSdpProblem } from '../../services/sdpLinkService';
import { TactileButton } from '../../components/TactileButton';
import { SdpIcon } from './SdpIcon';
import { Modal } from '../../components/Modal';
import { navigateTicketWorkspace } from './ticketNavigation';

export function SdpRelationships({ ticket }: Readonly<{ ticket: SdpQueueTicket }>) {
  const links = useCollection<SdpLink>(SDP_LINK_COLLECTION);
  const problems = useCollection<DynatraceProblemRecord>('dynatrace_problems');
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await links.refetch();
    } catch {
      setError('Could not save the link. Check the Relay connection and retry.');
    } finally {
      setBusy(false);
    }
  }
  const related = links.data.filter((link) => !link.suppressed && link.ticketId === ticket.id);
  return (
    <section className="ticket-related" aria-label="Live ticket relationships">
      <h4>Dynatrace problems</h4>
      {related.length === 0 && <p className="ticket-mode-note">No linked problems.</p>}
      {related.map((link) => (
        <div className="ticket-actions" key={link.id}>
          <button
            className="ticket-link sdp-external-link"
            title="Open ticket in SDP"
            onClick={() =>
              navigateTicketWorkspace({ destination: 'problem', problemId: link.problemId })
            }
          >
            {(() => {
              const problem = problems.data.find(
                (item) =>
                  item.problemId === link.problemId && item.environmentUrl === link.environment,
              );
              return problem
                ? `${problem.displayId || problem.problemId} · ${problem.title}`
                : `Problem ${link.problemId}`;
            })()}
          </button>
          <TactileButton
            size="sm"
            disabled={busy}
            onClick={() => void act(() => unlinkSdpProblem(link.id))}
          >
            Unlink
          </TactileButton>
        </div>
      ))}
      <details className="sdp-disclosure">
        <summary>Link a problem</summary>
        <label>
          <span>Find a problem</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title or problem ID"
          />
        </label>
        <div className="ticket-actions">
          <select
            aria-label="Problem to link"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose a problem</option>
            {problems.data
              .filter(
                (problem) =>
                  !problem.scopeExcluded &&
                  `${problem.displayId} ${problem.problemId} ${problem.title}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((problem) => (
                <option key={problem.id} value={problem.id}>
                  {problem.displayId || problem.problemId} · {problem.title}
                </option>
              ))}
          </select>
          <TactileButton
            size="sm"
            disabled={busy || !choice}
            onClick={() =>
              void act(async () => {
                const problem = problems.data.find((item) => item.id === choice);
                if (problem)
                  await linkSdpProblem({
                    ticketId: ticket.id,
                    ticketNumber: ticket.number,
                    problemId: problem.problemId,
                    environment: problem.environmentUrl,
                  });
              })
            }
          >
            Link problem
          </TactileButton>
        </div>
      </details>
      {(error || links.error || problems.error) && (
        <p role="alert">
          {error || 'Related information is unavailable. Reconnect to Relay and retry.'}
        </p>
      )}
    </section>
  );
}

export function SdpProblemTickets({ problem }: Readonly<{ problem: DynatraceProblemRecord }>) {
  const links = useCollection<SdpLink>(SDP_LINK_COLLECTION);
  const related = links.data.filter(
    (link) =>
      !link.suppressed &&
      link.problemId === problem.problemId &&
      link.environment === problem.environmentUrl,
  );
  return (
    <section className="sdp-problem-tickets" aria-label="Linked SDP tickets">
      <div className="sdp-relationship-heading">
        <h4>SDP tickets</h4>
        {related.length === 0 && !links.error && (
          <span className="ticket-mode-note">
            {links.loading ? 'Loading links…' : 'No linked tickets'}
          </span>
        )}
      </div>
      <div className="ticket-actions">
        {related.map((link) => (
          <button
            key={link.id}
            className="ticket-link sdp-external-link"
            title="Open ticket in SDP"
            onClick={() => void globalThis.api?.openExternal(sdpTicketUrl(link.ticketId))}
          >
            Ticket {link.ticketNumber} <SdpIcon name="external" />
          </button>
        ))}
      </div>
      {links.error && (
        <p role="alert">Ticket links are unavailable. Reconnect to Relay and retry.</p>
      )}
      <details className="sdp-disclosure">
        <summary>Ticket actions</summary>
        <div className="ticket-actions">
          <TactileButton
            size="sm"
            onClick={() => navigateTicketWorkspace({ destination: 'ticket', source: 'sdp' })}
          >
            Find or link a ticket
          </TactileButton>
          <TactileButton
            size="sm"
            variant="ghost"
            onClick={() =>
              navigateTicketWorkspace({
                destination: 'ticket',
                source: 'sdp',
                major: true,
                problem: { problemId: problem.problemId, environmentUrl: problem.environmentUrl },
              })
            }
          >
            Create SDP major incident
          </TactileButton>
        </div>
        <p className="ticket-mode-note">
          Workflow tickets link automatically. To link or unlink manually, open a ticket’s Related
          tab. Ticket numbers above open SDP.
        </p>
      </details>
    </section>
  );
}

export function SdpBridgeDialog({
  ticket,
  groups,
  onClose,
}: Readonly<{ ticket: SdpQueueTicket; groups: BridgeGroup[]; onClose: () => void }>) {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  function compose() {
    if (meetingUrl) {
      try {
        const url = new URL(meetingUrl);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('SdpRelationships: SDP operation did not return the expected result.');
      } catch {
        setError('Use an HTTPS meeting link without embedded credentials.');
        return;
      }
    }
    navigateTicketWorkspace({
      destination: 'bridge',
      bridge: {
        source: 'sdp',
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        subject: `Incident bridge · SDP ${ticket.number}`,
        meetingUrl,
        groupIds: selected,
      },
    });
    onClose();
  }
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      title="Prepare incident bridge"
      onClose={onClose}
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton variant="primary" onClick={compose}>
            Open composer
          </TactileButton>
        </>
      }
    >
      <p>
        Bring ticket {ticket.number} and a meeting link into Relay’s composer. Review recipients
        there before sharing. No meeting is created.
      </p>
      <label>
        <span>Meeting link</span>
        <input
          type="url"
          value={meetingUrl}
          onChange={(event) => setMeetingUrl(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>Suggested recipient groups</legend>
        {groups.map((group) => (
          <label key={group.id}>
            <input
              type="checkbox"
              checked={selected.includes(group.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, group.id]
                    : selected.filter((id) => id !== group.id),
                )
              }
            />
            {group.name}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
export function SdpBridgePanel({
  context,
  onClose,
  onUseGroups,
}: Readonly<{
  context: SdpBridgeContext;
  onClose: () => void;
  onUseGroups: (ids: string[]) => void;
}>) {
  const [message, setMessage] = useState('');
  async function copy() {
    const result = await globalThis.api
      ?.writeClipboard(
        [context.subject, sdpTicketUrl(context.ticketId), context.meetingUrl]
          .filter(Boolean)
          .join('\n'),
      )
      .catch(() => false);
    setMessage(
      result ? 'Bridge context copied. Review before sharing.' : 'Could not copy bridge context.',
    );
  }
  return (
    <section className="ticket-related ticket-bridge-panel" aria-label="SDP bridge context">
      <h3>{context.subject}</h3>
      <p>Ticket {context.ticketNumber} · Details remain in SDP.</p>
      {context.meetingUrl && <p>Meeting: {context.meetingUrl}</p>}
      <div className="ticket-actions">
        <TactileButton size="sm" onClick={() => void copy()}>
          Copy bridge context
        </TactileButton>
        <TactileButton size="sm" onClick={() => onUseGroups(context.groupIds)}>
          Use suggested groups
        </TactileButton>
        <TactileButton size="sm" onClick={onClose}>
          Dismiss context
        </TactileButton>
      </div>
      {message && (
        <p>
          <output>{message}</output>
        </p>
      )}
    </section>
  );
}
