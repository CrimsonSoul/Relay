import { SdpBulkDialog, SdpBulkControls } from './SdpBulkDialog';
import { SdpReplyStatus } from './SdpReplyStatus';
import { resetSdpNotifications } from './SdpAlerts';
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
} from '@shared/sdpAccount';
import {
  TabCommandBar,
  TabCommandGroup,
  TabPageHeader,
} from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import type { SdpQueueFilters } from '@shared/sdpQueueFilters';
import { SdpAccountPanel } from './SdpAccountPanel';
import type { SdpDetailSection } from './SdpTicketContent';
import { SdpTicketWorkspace } from './SdpTicketWorkspace';
export { SdpBody } from './SdpTicketContent';
const date = (value: number | null): string =>
  value === null ? 'Not set' : new Date(value).toLocaleString();

export function LiveSdpQueues({
  groups = [],
  request,
}: Readonly<{ groups?: BridgeGroup[]; request?: TicketOpenRequest }>) {
  const [nativeEditor, setNativeEditor] = useState<'edit' | 'reply' | 'forward'>();
  const [filters, setFilters] = useState({ status: '', priority: '', technician: '', due: '' });
  const [editor, setEditor] = useState<{
    mode: SdpChangeMode;
    ticket?: import('@shared/sdpAccount').SdpQueueTicket;
    problem?: NonNullable<TicketOpenRequest['problem']>;
  }>();
  const handledRequest = useRef(0);
  const openedFrom = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<SdpAccountView>();
  const [queue, setQueue] = useState<SdpQueue>('NOC');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [openedTicket, setOpenedTicket] = useState<import('@shared/sdpAccount').SdpQueueTicket>();
  const [detailSection, setDetailSection] = useState<SdpDetailSection>('Conversations');
  const [account, setAccount] = useState(false);
  const [error, setError] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkTickets, setBulkTickets] = useState<import('@shared/sdpAccount').SdpQueueTicket[]>();
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
  async function run(command: SdpAccountCommand) {
    if (command.action !== 'readDetail') setBulkIds([]);
    if (!invoke || pending.current || bulkTickets) return;
    const current = ++epoch.current;
    pending.current = true;
    setRequestBusy(true);
    setError('');
    if (command.action === 'readDetail') {
      if (selected !== command.id) setDetailSection('Conversations');
      setView((old) =>
        old ? { ...old, detail: undefined, detailSnapshot: undefined, message: undefined } : old,
      );
      setOpenedTicket(
        (old) => view?.queuePage?.tickets.find((item) => item.id === command.id) ?? old,
      );
      setSelected(command.id);
    } else {
      setView((old) =>
        old
          ? {
              ...old,
              queuePage: undefined,
              detail: undefined,
              snapshot: undefined,
              detailSnapshot: undefined,
            }
          : old,
      );
      setSelected('');
      setOpenedTicket(undefined);
    }
    if (command.action === 'clearCopies') {
      setSearch('');
      resetSdpNotifications();
    }
    try {
      const result = await invoke(command);
      if (!result.success || !result.data)
        throw new Error(result.error ?? 'SDP could not complete this action.');
      if (alive.current && current === epoch.current) setView(result.data);
    } catch {
      if (alive.current && current === epoch.current) {
        setView(undefined);
        setError(
          'Could not load SDP. Check the server connection and your work sign-in, then retry.',
        );
      }
    } finally {
      pending.current = false;
      if (alive.current) setRequestBusy(false);
    }
  }
  useEffect(() => {
    if (!available) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || pending.current || refreshing.current) return;
      checking = true;
      const current = epoch.current;
      try {
        const result = await invoke!({ action: 'status' });
        if (!active || current !== epoch.current) return;
        if (result.success && result.data) {
          setView(result.data);
          setError('');
        } else {
          setView(undefined);
          setError('Relay is unavailable. Live ticket data has been hidden.');
        }
      } catch {
        if (active && current === epoch.current) {
          setView(undefined);
          setError('Relay is unavailable. Live ticket data has been hidden.');
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
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
      if (alive.current && current === epoch.current && result.success && result.data)
        setView(result.data);
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
  const result =
    view?.queuePage?.queue === queue && view.queuePage.page === page ? view.queuePage : undefined;
  const tickets =
    result?.tickets.filter(
      (ticket) =>
        `${ticket.number} ${ticket.subject} ${ticket.technician}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!filters.status || ticket.status === filters.status) &&
        (!filters.priority || ticket.priority === filters.priority) &&
        (!filters.technician || ticket.technician === filters.technician) &&
        (!filters.due ||
          (ticket.dueAt !== null &&
            (filters.due === 'overdue'
              ? ticket.dueAt < Date.now()
              : ticket.dueAt >= Date.now() && ticket.dueAt < Date.now() + 86400000))),
    ) ?? [];
  const queueTicket = selectedTicket(view, selected, openedTicket);
  const ticket =
    queueTicket && view?.replyActivity?.id === selected
      ? {
          ...queueTicket,
          ...view.replyActivity,
        }
      : queueTicket;
  function load(nextQueue: SdpQueue, nextPage = 0) {
    if (nextQueue === queue && result?.filters) {
      setPage(nextPage);
      void run({ action: 'readQueue', queue: nextQueue, page: nextPage, filters: result.filters });
      return;
    }
    setQueue(nextQueue);
    setPage(nextPage);
    setSearch('');
    setFilters({ status: '', priority: '', technician: '', due: '' });
    void run({ action: 'readQueue', queue: nextQueue, page: nextPage });
  }
  const showWorkspace = connected || !!result || !!ticket || !!editor || !!nativeEditor;
  const resultCaption = `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`;
  const filterCaption = result?.filters ? ' · Filtered' : '';
  return (
    <div className={`tab-layout tickets-tab ${ticket ? 'has-open-ticket' : ''}`}>
      <TabPageHeader
        context="Service desk"
        title="Tickets"
        metadata={<span className="ticket-mode-label">SDP · Your work account</span>}
      />
      {showWorkspace && (
        <>
          <TabCommandBar ariaLabel="Live ticket actions">
            <TabCommandGroup kind="utility">
              <TactileButton size="sm" variant="ghost" onClick={() => setAccount(true)}>
                Work account
              </TactileButton>
              <TactileButton
                size="sm"
                disabled={busy || !connected || !!nativeEditor}
                onClick={() => load(queue, page)}
              >
                {busy ? 'Loading…' : 'Refresh queue'}
              </TactileButton>
              {view?.testControls === true && (
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={busy || !connected || !!nativeEditor}
                  onClick={() => void run({ action: 'clearCopies' })}
                >
                  Clear my saved SDP data
                </TactileButton>
              )}
            </TabCommandGroup>
            <TabCommandGroup kind="workflow">
              <SdpBulkControls
                view={view}
                disabled={busy || !connected || !!nativeEditor}
                ids={bulkIds}
                onSelect={setBulkIds}
                onOpen={setBulkTickets}
              />
              <TactileButton
                size="sm"
                disabled={busy || !connected || !!nativeEditor}
                onClick={() => setEditor({ mode: 'major' })}
              >
                Major incident
              </TactileButton>
              <TactileButton
                size="sm"
                disabled={busy || !connected || !!nativeEditor}
                variant="primary"
                onClick={() => setEditor({ mode: 'create' })}
              >
                New ticket
              </TactileButton>
            </TabCommandGroup>
          </TabCommandBar>
          <div className="sdp-queue-navigation">
            <nav className="ticket-queues" aria-label="Live SDP queues">
              {SDP_QUEUES.map((name) => (
                <button
                  key={name}
                  title={name === 'Unassigned' ? 'Tickets without a support group' : undefined}
                  aria-current={name === queue ? 'page' : undefined}
                  disabled={busy || !connected || !!nativeEditor}
                  onClick={() => load(name)}
                >
                  {name}
                </button>
              ))}
            </nav>
            {result && view?.snapshot && (
              <output
                className="sdp-queue-sync"
                title={`Last synced ${date(view.snapshot.fetchedAt)} · Saved copy expires ${date(view.snapshot.expiresAt)}`}
              >
                {view.snapshot.source === 'outage-cache'
                  ? 'SDP unavailable · Saved copy · Read only'
                  : 'Live from SDP'}
              </output>
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
        <p role="alert" className="ticket-error">
          {error}
        </p>
      )}
      {view?.message && (
        <p className="ticket-mode-note">
          <output>{view.message}</output>
        </p>
      )}
      {!showWorkspace && (
        <SdpConnectionPrompt
          available={available}
          view={view}
          busy={busy}
          error={error}
          onConnect={() => setAccount(true)}
        />
      )}
      {showWorkspace && (
        <>
          {!ticket && result && (
            <section className="sdp-queue-overview" aria-label="Status counts on this page">
              <div className="sdp-queue-total">
                <span className="toolbar-title">{queue} queue</span>
                <strong>
                  {result.tickets.length}
                  <small> on this page</small>
                </strong>
              </div>
              <dl className="sdp-status-counts">
                {[...new Set(result.tickets.map((item) => item.status))].map((status) => (
                  <div key={status}>
                    <dt>{status}</dt>
                    <dd>{result.tickets.filter((item) => item.status === status).length}</dd>
                  </div>
                ))}
              </dl>
              <div className="sdp-reply-count">
                <span>Unread replies</span>
                <strong>{result.tickets.filter((item) => item.replyUnread).length}</strong>
              </div>
            </section>
          )}
          <div className="sdp-queue-filters" aria-label="Queue filters">
            <label className="ticket-search">
              <span>Search tickets</span>
              <input
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ticket, subject, technician…"
              />
            </label>
            {(
              [
                ['status', 'Status'],
                ['priority', 'Priority'],
                ['technician', 'Technician'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={label}
                  value={filters[key]}
                  onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
                >
                  <option value="">All</option>
                  {[...new Set(result?.tickets.map((t) => t[key]) ?? [])]
                    .sort((a, b) => a.localeCompare(b))
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </label>
            ))}
            <label>
              <span>Due</span>
              <select
                aria-label="Due"
                value={filters.due}
                onChange={(event) => setFilters({ ...filters, due: event.target.value })}
              >
                <option value="">Any time</option>
                <option value="overdue">Overdue</option>
                <option value="today">Next 24 hours</option>
              </select>
            </label>
            <TactileButton
              size="sm"
              disabled={busy || !connected || !!nativeEditor}
              onClick={() => {
                const filter = Object.fromEntries(
                  Object.entries({ ...filters, search }).filter(([, v]) => v),
                ) as SdpQueueFilters;
                setPage(0);
                void run({
                  action: 'readQueue',
                  queue,
                  page: 0,
                  ...(Object.keys(filter).length ? { filters: filter } : {}),
                });
              }}
            >
              Apply filters
            </TactileButton>
            <TactileButton
              size="sm"
              variant="ghost"
              disabled={busy || !!nativeEditor}
              onClick={() => {
                setFilters({ status: '', priority: '', technician: '', due: '' });
                setSearch('');
                setPage(0);
                if (connected) void run({ action: 'readQueue', queue, page: 0 });
              }}
            >
              Clear filters
            </TactileButton>
          </div>
          <div className={`ticket-workspace sdp-split-workspace ${ticket ? 'has-ticket' : ''}`}>
            <section className="ticket-list" aria-label="Live tickets in queue">
              <div className="ticket-list-caption">
                <span>{result ? `${resultCaption}${filterCaption}` : 'Queue not loaded'}</span>
              </div>
              <table className="sdp-live-table">
                <colgroup>
                  <col className="sdp-live-subject-column" />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Priority / status</th>
                    <th>Group / technician</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selected ? 'sdp-selected-row' : undefined}
                    >
                      <td>
                        <label className="sdp-select-ticket">
                          <input
                            type="checkbox"
                            aria-label={`Select ticket ${item.number}`}
                            checked={bulkIds.includes(item.id)}
                            disabled={
                              busy ||
                              !!nativeEditor ||
                              view?.snapshot?.source !== 'live' ||
                              (!bulkIds.includes(item.id) && bulkIds.length >= 20)
                            }
                            onChange={(event) => toggleBulk(item.id, event.target.checked)}
                          />
                          <span>Select</span>
                        </label>
                        <button
                          className="ticket-row-open"
                          aria-label={`Open ticket ${item.number}: ${item.subject || 'No subject'}`}
                          disabled={busy || !!nativeEditor}
                          onClick={(event) => {
                            openedFrom.current = event.currentTarget;
                            void run({ action: 'readDetail', id: item.id, page: 0 });
                          }}
                        >
                          <span className="sdp-row-topline">
                            <span className="ticket-id">#{item.number}</span>
                            <span className="sdp-row-priority">{item.priority}</span>
                          </span>
                          <strong>{item.subject || 'No subject'}</strong>
                          <SdpReplyStatus ticket={item} />
                          <span className="sdp-row-context">
                            <span>{item.status}</span>
                            <span>{item.technician || 'Unassigned'}</span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="ticket-priority">{item.priority}</span>
                        <small className="sdp-row-status">{item.status}</small>
                      </td>
                      <td>
                        {item.group}
                        <small>{item.technician}</small>
                      </td>
                      <td>{date(item.dueAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result && tickets.length === 0 && (
                <p className="ticket-list-caption">
                  {search ? 'No matches in these results.' : 'No tickets returned for this queue.'}
                </p>
              )}
              {!result && connected && !busy && (
                <p className="ticket-list-caption">
                  Choose a queue or Refresh queue to load tickets.
                </p>
              )}
              <div className="ticket-actions sdp-queue-pagination">
                <TactileButton
                  size="sm"
                  disabled={busy || !!nativeEditor || !connected || page === 0}
                  onClick={() => load(queue, page - 1)}
                >
                  Previous
                </TactileButton>
                <TactileButton
                  size="sm"
                  disabled={busy || !!nativeEditor || !result?.hasMore || page >= 19}
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
                onClose={() => {
                  setSelected('');
                  setOpenedTicket(undefined);
                  requestAnimationFrame(() => openedFrom.current?.focus());
                }}
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
      {account && <SdpAccountPanel onClose={() => setAccount(false)} />}
    </div>
  );
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
      {available && !view && !error && (
        <p>
          <output>Checking connection…</output>
        </p>
      )}
      {available && (
        <TactileButton variant="primary" disabled={busy || (!view && !error)} onClick={onConnect}>
          {view?.status === 'connecting' ? 'Continue work sign-in' : 'Connect work account'}
        </TactileButton>
      )}
    </section>
  );
}

function selectedTicket(
  view: SdpAccountView | undefined,
  selected: string,
  opened?: import('@shared/sdpAccount').SdpQueueTicket,
) {
  return (
    view?.queuePage?.tickets.find((item) => item.id === selected) ??
    (view?.replyActivity?.id === selected ? view.replyActivity : undefined) ??
    (opened?.id === selected ? opened : undefined)
  );
}
