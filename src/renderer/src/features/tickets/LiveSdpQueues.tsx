import { SdpBulkDialog, SdpBulkControls } from './SdpBulkDialog';
import { SdpReplyCell } from './SdpReplyStatus';
import { SdpQueueFilterBar } from './SdpQueueFilterBar';
import { DueTime, priorityClass, technicianLabel } from './sdpQueueFormat';
import { useSdpTicketShortcuts } from './useSdpTicketShortcuts';
import { resetSdpNotifications } from './SdpAlerts';
import { subscribeSdpStatus } from './sdpStatusPoller';
import type { BridgeGroup } from '@shared/ipc';
import type { TicketOpenRequest } from '../../tabs/TicketsTab';
import { SdpChangeDialog, type SdpChangeMode } from './SdpChangeDialog';
import { linkSdpProblem } from '../../services/sdpLinkService';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  SDP_QUEUES,
  type SdpAccountCommand,
  type SdpAccountView,
  type SdpQueue,
  type SdpQueueTicket,
} from '@shared/sdpAccount';
import {
  TabCommandBar,
  TabCommandGroup,
  TabPageHeader,
} from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import { Tooltip } from '../../components/Tooltip';
import { StatusBar, StatusBarLive } from '../../components/StatusBar';
import { SdpAccountPanel } from './SdpAccountPanel';
import type { SdpDetailSection } from './SdpTicketContent';
import { SdpTicketWorkspace } from './SdpTicketWorkspace';
import { formatOpsTime } from '../../utils/opsTime';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
const date = (value: number | null): string =>
  value === null ? 'Not set' : new Date(value).toLocaleString();

export function LiveSdpQueues({
  groups = [],
  request,
}: Readonly<{ groups?: BridgeGroup[]; request?: TicketOpenRequest }>) {
  const [nativeEditor, setNativeEditor] = useState<'edit' | 'reply' | 'forward'>();
  const [editor, setEditor] = useState<{
    mode: SdpChangeMode;
    ticket?: SdpQueueTicket;
    problem?: NonNullable<TicketOpenRequest['problem']>;
  }>();
  const handledRequest = useRef(0);
  const openedFrom = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<SdpAccountView>();
  const [queue, setQueue] = useState<SdpQueue>('NOC');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [openedTicket, setOpenedTicket] = useState<SdpQueueTicket>();
  const [detailSection, setDetailSection] = useState<SdpDetailSection>('Conversations');
  const [account, setAccount] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkTickets, setBulkTickets] = useState<SdpQueueTicket[]>();
  const busy = requestBusy || !!bulkTickets;
  const pending = useRef(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const refreshing = useRef(false);
  const invoke = globalThis.api?.sdpAccount;
  const available = globalThis.api?.runtime.kind === 'electron' && !!invoke;
  const connected = view?.status === 'connected';
  const openNotifiedTicket = useEffectEvent(
    (id: string) => void run({ action: 'readDetail', id, page: 0 }),
  );
  useEffect(() => {
    if (
      !connected ||
      request?.source !== 'sdp' ||
      request.sequence === handledRequest.current ||
      nativeEditor ||
      editor ||
      requestBusy
    )
      return;
    handledRequest.current = request.sequence;
    if (request.major) setEditor({ mode: 'major', problem: request.problem });
    else if (request.ticketId) openNotifiedTicket(request.ticketId);
  }, [connected, request, nativeEditor, editor, requestBusy]);
  useEffect(() => {
    if (!connected && !requestBusy) {
      setEditor(undefined);
      setNativeEditor(undefined);
      setSelected('');
      setOpenedTicket(undefined);
    }
  }, [connected, requestBusy]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function toggleBulk(id: string, checked: boolean) {
    setBulkIds((ids) => (checked ? [...ids, id] : ids.filter((value) => value !== id)));
  }
  function beginRead(command: SdpAccountCommand) {
    const switching = command.action === 'readDetail' && selected !== command.id;
    setView((old) => old && pendingView(old, command, switching));
    if (command.action === 'readDetail') {
      if (switching) setDetailSection('Conversations');
      setOpenedTicket(
        (old) => view?.queuePage?.tickets.find((item) => item.id === command.id) ?? old,
      );
      setSelected(command.id);
      return;
    }
    setBulkIds([]);
    setSelected('');
    setOpenedTicket(undefined);
    if (command.action === 'clearCopies') resetSdpNotifications();
  }
  async function run(command: SdpAccountCommand) {
    if (!invoke || pending.current || bulkTickets) return;
    const current = ++epoch.current;
    pending.current = true;
    setRequestBusy(true);
    setLoadingQueue(command.action === 'readQueue');
    setError('');
    beginRead(command);
    try {
      const result = await invoke(command);
      if (!result.success || !result.data)
        throw new Error(result.error ?? 'SDP could not complete this action.');
      if (alive.current && current === epoch.current) {
        setView(result.data);
        setStale(false);
        setNotice('');
      }
    } catch {
      if (alive.current && current === epoch.current) {
        setStale(true);
        setError(
          'Could not load SDP. Check the server connection and your work sign-in, then retry.',
        );
      }
    } finally {
      pending.current = false;
      if (alive.current) {
        setRequestBusy(false);
        setLoadingQueue(false);
      }
    }
  }
  const statusFailed = useEffectEvent(() => {
    // A missed status check is not a sign-out: keep what is on screen (snapshot expiry still
    // removes it) and say so, rather than hiding the queue on one transport failure.
    setStale(true);
    setNotice(
      view?.queuePage || view?.detail
        ? 'Relay is not responding. Showing the last loaded tickets until the saved copy expires.'
        : 'Could not check your SDP connection. Relay will keep trying.',
    );
  });
  useEffect(() => {
    if (!available) return;
    let active = true;
    const unsubscribe = subscribeSdpStatus(() => {
      if (pending.current || refreshing.current) return;
      const current = epoch.current;
      return (outcome) => {
        if (!active || current !== epoch.current) return;
        if ('result' in outcome && outcome.result.success && outcome.result.data) {
          setView(outcome.result.data);
          setError('');
          setNotice('');
          setStale(false);
        } else statusFailed();
      };
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [available, invoke]);
  const refreshVisible = useEffectEvent(async () => {
    if (
      !invoke ||
      !connected ||
      pending.current ||
      refreshing.current ||
      nativeEditor ||
      editor ||
      bulkTickets ||
      account
    )
      return;
    const current = ++epoch.current;
    refreshing.current = true;
    try {
      const result = await invoke({ action: 'refreshVisible' });
      if (alive.current && current === epoch.current && result.success && result.data) {
        setView(result.data);
        setStale(false);
        setNotice('');
      }
    } finally {
      refreshing.current = false;
    }
  });
  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => {
      void refreshVisible().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [available]);
  useEffect(() => {
    // Opening a draft invalidates any older background response without resetting the draft.
    if (nativeEditor || editor || bulkTickets || account) epoch.current++;
  }, [nativeEditor, editor, bulkTickets, account]);
  function applyResult(next: SdpAccountView) {
    epoch.current++;
    setView(next);
  }
  useEffect(() => {
    if (!view?.snapshot) return;
    const timer = setTimeout(
      () => {
        setView((old) =>
          old ? { ...old, queuePage: undefined, ticket: undefined, snapshot: undefined } : old,
        );
        setSelected('');
        setOpenedTicket(undefined);
      },
      Math.max(0, view.snapshot.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view?.snapshot]);
  useEffect(() => {
    if (!view?.detailSnapshot) return;
    const timer = setTimeout(
      () =>
        setView((old) => (old ? { ...old, detail: undefined, detailSnapshot: undefined } : old)),
      Math.max(0, view.detailSnapshot.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view?.detailSnapshot]);
  const result = visiblePage(view, queue, page);
  const tickets = result?.tickets ?? [];
  const ticket = selectedTicket(view, selected, openedTicket);
  function load(nextQueue: SdpQueue, nextPage = 0) {
    if (nextQueue === queue && result?.filters) {
      setPage(nextPage);
      void run({ action: 'readQueue', queue: nextQueue, page: nextPage, filters: result.filters });
      return;
    }
    setQueue(nextQueue);
    setPage(nextPage);
    void run({ action: 'readQueue', queue: nextQueue, page: nextPage });
  }
  function openTicket(id: string, from: HTMLButtonElement | null) {
    openedFrom.current = from;
    void run({ action: 'readDetail', id, page: 0 });
  }
  function closeTicket() {
    setSelected('');
    setOpenedTicket(undefined);
    requestAnimationFrame(() => openedFrom.current?.focus());
  }
  const table = useRef<HTMLTableElement>(null);
  const detailLive =
    view?.detailSnapshot?.source === 'live' && !!ticket && view.detail?.id === ticket.id;
  useSdpTicketShortcuts({
    blocked: busy || !!nativeEditor || !!editor || account,
    onMove(step) {
      const rows = [
        ...(table.current?.querySelectorAll<HTMLButtonElement>('button.ticket-row-open') ?? []),
      ];
      const next = adjacentRow(rows, tickets, ticket?.id, step);
      if (next === undefined) return;
      if (ticket) openTicket(next.id, next.row);
      else next.row.focus();
    },
    onReply: detailLive
      ? () => {
          setDetailSection('Conversations');
          setNativeEditor('reply');
        }
      : undefined,
    onBack: ticket ? closeTicket : undefined,
  });
  const showWorkspace = connected || !!result || !!ticket || !!editor || !!nativeEditor;
  const draftLocked = busy || !!nativeEditor;
  const queueLocked = draftLocked || !connected;
  const emptyMessage = queueEmptyMessage(result, connected && !busy);
  return (
    <div className={`tab-layout tickets-tab ${ticket ? 'has-open-ticket' : ''}`}>
      <TabPageHeader title="Tickets" subtitle="SDP work account" />
      {showWorkspace && (
        <>
          <TabCommandBar ariaLabel="Live ticket actions">
            <TabCommandGroup kind="utility">
              <TactileButton size="sm" variant="ghost" onClick={() => setAccount(true)}>
                Work Account
              </TactileButton>
              <TactileButton size="sm" disabled={queueLocked} onClick={() => load(queue, page)}>
                {loadingQueue ? 'Loading…' : 'Refresh Queue'}
              </TactileButton>
              {view?.testControls === true && (
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={queueLocked}
                  onClick={() => void run({ action: 'clearCopies' })}
                >
                  Clear My Saved SDP Data
                </TactileButton>
              )}
            </TabCommandGroup>
            <TabCommandGroup kind="workflow">
              <SdpBulkControls
                view={view}
                disabled={queueLocked}
                ids={bulkIds}
                onSelect={setBulkIds}
                onOpen={setBulkTickets}
              />
              <TactileButton disabled={queueLocked} onClick={() => setEditor({ mode: 'major' })}>
                Major Incident
              </TactileButton>
              <TactileButton
                disabled={queueLocked}
                variant="primary"
                onClick={() => setEditor({ mode: 'create' })}
              >
                New Ticket
              </TactileButton>
            </TabCommandGroup>
          </TabCommandBar>
          <div className="sdp-queue-navigation">
            <div className="sdp-queue-tabs">
              <nav className="ticket-queues tab-strip" aria-label="Live SDP queues">
                {SDP_QUEUES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="tab-strip__tab"
                    aria-current={name === queue ? 'page' : undefined}
                    disabled={queueLocked}
                    onClick={() => load(name)}
                  >
                    {name}
                  </button>
                ))}
              </nav>
            </div>
            {result && view?.snapshot && (
              <div className="sdp-queue-tabs">
                {/* The exact sync and expiry times sit in a focusable Tooltip (keyboard and touch
                    reach it), not a mouse-only title. */}
                <Tooltip
                  content={`Last synced ${date(view.snapshot.fetchedAt)} · Saved copy expires ${date(view.snapshot.expiresAt)}`}
                  width="min(320px, 80vw)"
                >
                  {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                  <span tabIndex={0}>
                    <output className="sdp-queue-sync">{syncLabel(view.snapshot, stale)}</output>
                  </span>
                </Tooltip>
              </div>
            )}
          </div>
        </>
      )}

      {request?.ticketId &&
        request.sequence !== handledRequest.current &&
        (nativeEditor || editor) && (
          <p className="ticket-mode-note">
            <output>Finish or cancel your draft to open the notified ticket.</output>
          </p>
        )}
      {bulkTickets && (
        <SdpBulkDialog
          tickets={bulkTickets}
          onClose={() => {
            setBulkTickets(undefined);
            setBulkIds([]);
          }}
          onResult={applyResult}
        />
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <SdpMessage message={queueMessage(notice, view?.message)} />
      {!showWorkspace && (
        <SdpConnectionPrompt
          available={available}
          view={view}
          busy={busy}
          error={error || notice}
          onConnect={() => setAccount(true)}
        />
      )}
      {showWorkspace && (
        <>
          {result && <SdpQueueOverview queue={queue} tickets={result.tickets} />}
          <SdpQueueFilterBar
            key={queue}
            applied={result?.filters}
            tickets={tickets}
            disabled={draftLocked}
            connected={connected}
            onApply={(filters) => {
              setPage(0);
              void run({ action: 'readQueue', queue, page: 0, ...(filters ? { filters } : {}) });
            }}
          />
          <div className={`ticket-workspace sdp-split-workspace ${ticket ? 'has-ticket' : ''}`}>
            <section className="ticket-list" aria-label="Live tickets in queue">
              <div className="ticket-list-caption">
                <span>{queueCaption(result)}</span>
                {!ticket && tickets.length > 0 && (
                  <span className="sdp-shortcut-hint">J/K move · Enter opens · R replies</span>
                )}
              </div>
              <table className="sdp-live-table" ref={table}>
                <colgroup>
                  <col className="sdp-live-subject-column" />
                  <col className="sdp-live-priority-column" />
                  <col className="sdp-live-status-column" />
                  <col className="sdp-live-technician-column" />
                  <col className="sdp-live-reply-column" />
                  <col className="sdp-live-due-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Technician</th>
                    <th>Last reply</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((item) => (
                    <SdpQueueRow
                      key={item.id}
                      item={item}
                      selected={item.id === selected}
                      checked={bulkIds.includes(item.id)}
                      selectDisabled={
                        draftLocked ||
                        view?.snapshot?.source !== 'live' ||
                        (!bulkIds.includes(item.id) && bulkIds.length >= 20)
                      }
                      openDisabled={draftLocked}
                      onToggle={(checked) => toggleBulk(item.id, checked)}
                      onOpen={(from) => openTicket(item.id, from)}
                    />
                  ))}
                </tbody>
              </table>
              {emptyMessage && <p className="ticket-list-caption">{emptyMessage}</p>}
              <div className="ticket-actions sdp-queue-pagination">
                <TactileButton
                  size="sm"
                  disabled={queueLocked || page === 0}
                  onClick={() => load(queue, page - 1)}
                >
                  Previous
                </TactileButton>
                <TactileButton
                  size="sm"
                  disabled={draftLocked || !result?.hasMore || page >= 19}
                  onClick={() => load(queue, page + 1)}
                >
                  Next
                </TactileButton>
                <span className="sdp-page-number">Page {page + 1}</span>
              </div>
            </section>
            {ticket && (
              <SdpTicketWorkspace
                ticket={ticket}
                view={view}
                groups={groups}
                busy={busy}
                editor={nativeEditor}
                section={detailSection}
                onSection={setDetailSection}
                onEditor={setNativeEditor}
                onAction={(mode) => setEditor({ mode, ticket })}
                onResult={applyResult}
                onRefresh={(nextPage, includeAutoNotifications) =>
                  void run({
                    action: 'readDetail',
                    id: ticket.id,
                    page: nextPage,
                    ...((includeAutoNotifications ?? view?.detail?.includeAutoNotifications)
                      ? { includeAutoNotifications: true }
                      : {}),
                  })
                }
                onClose={closeTicket}
              />
            )}
          </div>
        </>
      )}
      {editor && (
        <SdpChangeDialog
          mode={editor.mode}
          ticket={editor.ticket}
          onClose={() => setEditor(undefined)}
          onResult={(next) => {
            applyResult(next);
            if (next.changeResult?.kind === 'create' && editor.problem && editor.mode === 'major') {
              void linkSdpProblem({
                ticketId: next.changeResult.id,
                ticketNumber: next.changeResult.number,
                problemId: editor.problem.problemId,
                environment: editor.problem.environmentUrl,
              }).catch(() =>
                setError(
                  'Ticket created, but the problem link was not saved. Open the ticket to link it.',
                ),
              );
            }
          }}
        />
      )}
      <StatusBar left={<StatusBarLive />} right={<span>{sdpStatusLabel(available, view)}</span>} />
      {account && <SdpAccountPanel onClose={() => setAccount(false)} />}
    </div>
  );
}

const SDP_STATUS_LABELS: Record<SdpAccountView['status'], string> = {
  connected: 'SDP connected',
  connecting: 'SDP sign-in in progress',
  expired: 'SDP session expired',
  disconnected: 'SDP not connected',
};

/**
 * A failed status check (notice) is an error; any newer view clears it, so it always outranks the
 * view's message. The view's message is server copy with no tone and stays in the status output.
 */
function queueMessage(notice: string, viewMessage: string | undefined): SdpNotice | undefined {
  if (notice) return sdpError(notice);
  return viewMessage ? sdpInfo(viewMessage) : undefined;
}
function sdpStatusLabel(available: boolean, view: SdpAccountView | undefined): string {
  if (!available) return 'SDP available on desktop';
  return view ? SDP_STATUS_LABELS[view.status] : 'Checking SDP connection…';
}

function SdpConnectionPrompt({
  available,
  view,
  busy,
  error,
  onConnect,
}: Readonly<{
  available: boolean;
  view: SdpAccountView | undefined;
  busy: boolean;
  error: string;
  onConnect: () => void;
}>) {
  let title = 'Live tickets are available on desktop';
  if (available)
    title =
      view?.status === 'expired' ? 'Reconnect your work account' : 'Connect your work account';
  return (
    <section className="sdp-connect-state" aria-label="Ticket connection">
      <h2>{title}</h2>
      <p>
        {available
          ? 'Sign in to view your SDP queues and work on tickets. Your work account determines access.'
          : 'Open Relay desktop to connect your SDP account. Web sign-in is not available yet.'}
      </p>
      <ul className="sdp-connect-state__benefits" aria-label="What connecting enables">
        <li>Your SDP queues, filters and ticket detail in one workspace</li>
        <li>Keyboard triage: J/K to move between tickets, R to reply</li>
        <li>Possible SDP changes shown beside Dynatrace problems</li>
      </ul>
      {available && !view && !error && (
        <p>
          <output>Checking connection…</output>
        </p>
      )}
      {available && (
        <TactileButton variant="primary" disabled={busy || (!view && !error)} onClick={onConnect}>
          {view?.status === 'connecting' ? 'Continue Work Sign-In' : 'Connect Work Account'}
        </TactileButton>
      )}
    </section>
  );
}

/** The open ticket, with any newer reply activity merged over the queue row. */
function selectedTicket(
  view: SdpAccountView | undefined,
  selected: string,
  opened?: SdpQueueTicket,
): SdpQueueTicket | undefined {
  const reply = view?.replyActivity?.id === selected ? view.replyActivity : undefined;
  const row =
    view?.queuePage?.tickets.find((item) => item.id === selected) ??
    reply ??
    (opened?.id === selected ? opened : undefined);
  return row && reply ? { ...row, ...reply } : row;
}

function visiblePage(view: SdpAccountView | undefined, queue: SdpQueue, page: number) {
  const current = view?.queuePage;
  return current?.queue === queue && current.page === page ? current : undefined;
}

function syncLabel(snapshot: NonNullable<SdpAccountView['snapshot']>, stale: boolean): string {
  if (stale) return `Not updated since ${formatOpsTime(snapshot.fetchedAt)} · Retrying`;
  return snapshot.source === 'outage-cache'
    ? 'SDP unavailable · Saved copy · Read only'
    : 'Live from SDP';
}

/**
 * Pending state for a read: an open ticket's detail stays while it reloads (showing the requested
 * automatic-notification setting); queue rows stay until replaced.
 */
function pendingView(
  old: SdpAccountView,
  command: SdpAccountCommand,
  switching: boolean,
): SdpAccountView {
  if (command.action === 'readDetail') {
    if (switching)
      return { ...old, message: undefined, detail: undefined, detailSnapshot: undefined };
    const includeAutoNotifications = command.includeAutoNotifications ?? false;
    return {
      ...old,
      message: undefined,
      detail: old.detail && { ...old.detail, includeAutoNotifications },
    };
  }
  const cleared = { ...old, detail: undefined, detailSnapshot: undefined };
  return command.action === 'clearCopies'
    ? { ...cleared, queuePage: undefined, snapshot: undefined }
    : cleared;
}

/** J/K target: the row after the open ticket, or after the focused row when no ticket is open. */
function adjacentRow(
  rows: HTMLButtonElement[],
  tickets: readonly SdpQueueTicket[],
  openId: string | undefined,
  step: 1 | -1,
): { id: string; row: HTMLButtonElement } | undefined {
  const anchor = openId
    ? tickets.findIndex((item) => item.id === openId)
    : rows.indexOf(document.activeElement as HTMLButtonElement);
  let next = anchor + step;
  if (anchor < 0) next = step === 1 ? 0 : rows.length - 1;
  const row = rows[next];
  const target = tickets[next];
  return row && target ? { id: target.id, row } : undefined;
}

function SdpQueueOverview({
  queue,
  tickets,
}: Readonly<{ queue: SdpQueue; tickets: readonly SdpQueueTicket[] }>) {
  return (
    <section className="sdp-queue-overview" aria-label="Status counts on this page">
      <div className="sdp-queue-total">
        <span className="toolbar-title">{queue} queue</span>
        <strong>
          {tickets.length}
          <small> on this page</small>
        </strong>
      </div>
      <dl className="sdp-status-counts">
        {[...new Set(tickets.map((item) => item.status))].map((status) => (
          <div key={status}>
            <dt>{status}</dt>
            <dd>{tickets.filter((item) => item.status === status).length}</dd>
          </div>
        ))}
      </dl>
      <div className="sdp-reply-count">
        <span>Unread replies</span>
        <strong>{tickets.filter((item) => item.replyUnread).length}</strong>
      </div>
    </section>
  );
}

function SdpQueueRow({
  item,
  selected,
  checked,
  selectDisabled,
  openDisabled,
  onToggle,
  onOpen,
}: Readonly<{
  item: SdpQueueTicket;
  selected: boolean;
  checked: boolean;
  selectDisabled: boolean;
  openDisabled: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: (from: HTMLButtonElement) => void;
}>) {
  const subject = item.subject || 'No subject';
  return (
    <tr className={selected ? 'sdp-selected-row' : undefined}>
      <td>
        <div className="sdp-row-main">
          <label className="sdp-select-ticket">
            <input
              type="checkbox"
              aria-label={`Select ticket ${item.number}`}
              checked={checked}
              disabled={selectDisabled}
              onChange={(event) => onToggle(event.target.checked)}
            />
          </label>
          <button
            className="ticket-row-open"
            aria-label={`Open ticket ${item.number}: ${subject}`}
            disabled={openDisabled}
            onClick={(event) => onOpen(event.currentTarget)}
          >
            <span className="ticket-id">#{item.number}</span>
            <strong title={subject}>{subject}</strong>
            {item.replyUnread && <span className="sdp-unread-reply sdp-row-unread">Unread</span>}
            <span className="sdp-row-priority">{item.priority}</span>
          </button>
        </div>
      </td>
      <td>
        <span className={priorityClass(item.priority)}>{item.priority}</span>
      </td>
      <td>{item.status}</td>
      <td>{technicianLabel(item.technician)}</td>
      <td>
        <SdpReplyCell ticket={item} />
      </td>
      <td>
        <DueTime dueAt={item.dueAt} />
      </td>
    </tr>
  );
}

function queueCaption(result: SdpAccountView['queuePage']): string {
  if (!result) return 'Queue not loaded';
  const count = `${result.tickets.length} ${result.tickets.length === 1 ? 'ticket' : 'tickets'}`;
  return result.filters ? `${count} · Filtered by SDP` : count;
}

function queueEmptyMessage(result: SdpAccountView['queuePage'], canLoad: boolean) {
  if (!result) return canLoad ? 'Choose a queue or Refresh Queue to load tickets.' : undefined;
  if (result.tickets.length > 0) return undefined;
  return result.filters
    ? 'No tickets in this queue match these filters.'
    : 'No tickets returned for this queue.';
}
