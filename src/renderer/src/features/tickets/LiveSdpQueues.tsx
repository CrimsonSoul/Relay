import { SdpBulkDialog, SdpBulkControls } from './SdpBulkDialog';
import { SdpQueueManager } from './SdpQueueManager';
import { SdpSearchForm, SdpSearchResults, useSdpTicketSearch } from './SdpTicketSearch';
import {
  readSdpPageSize,
  readSdpQueueSort,
  readSdpQueues,
  readSdpRowColors,
  saveSdpPageSize,
  saveSdpQueueSort,
  saveSdpQueues,
  saveSdpRowColors,
  type SdpPageSize,
  type SdpRowColors,
} from './sdpQueuePreferences';
import { rowTint, SdpRowColorLegend, SdpRowColorsDialog } from './SdpRowColors';
import { SdpReplyCell } from './SdpReplyStatus';
import { queueFiltersKey, SdpQueueFilterBar } from './SdpQueueFilterBar';
import { CreatedTime, priorityClass, technicianLabel, VipBadge, vipFirst } from './sdpQueueFormat';
import { conversationState, type SdpConversationState } from './sdpQueueIndicators';
import { SdpCommandIcon, SdpIcon } from './SdpIcon';
import { useSdpTicketShortcuts } from './useSdpTicketShortcuts';
import { resetSdpNotifications } from './SdpAlerts';
import { subscribeSdpStatus } from './sdpStatusPoller';
import type { BridgeAPI, BridgeGroup } from '@shared/ipc';
import type { TicketOpenRequest } from '../../tabs/TicketsTab';
import { SdpChangeDialog, type SdpChangeMode } from './SdpChangeDialog';
import { linkSdpProblem } from '../../services/sdpLinkService';
import { getPb } from '../../services/pocketbase';
import { SdpQueueFiltersSchema, type SdpQueueFilters } from '@shared/sdpQueueFilters';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { SDP_BULK_MAX } from '@shared/sdpMutation';
import {
  SDP_PAGE_SIZE,
  SDP_PAGE_SIZES,
  SDP_SERVER_UPDATE_MESSAGE,
  type SdpAccountCommand,
  type SdpAccountProfile,
  type SdpAccountView,
  type SdpQueue,
  type SdpQueueSort,
  type SdpQueueSortField,
  type SdpQueueTicket,
} from '@shared/sdpAccount';
import {
  TabCommandBar,
  TabCommandGroup,
  TabPageHeader,
} from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import { Tooltip } from '../../components/Tooltip';
import { FreshnessText } from '../../components/TabFreshness';
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
  const [queues, setQueues] = useState(readSdpQueues);
  const [queue, setQueue] = useState<SdpQueue>(() => queues[0] ?? 'NOC');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readSdpPageSize);
  const [sort, setSort] = useState(readSdpQueueSort);
  const [rowColors, setRowColors] = useState(readSdpRowColors);
  const [editingColors, setEditingColors] = useState(false);
  const [managingQueues, setManagingQueues] = useState(false);
  const filterStorageKey = `relay:sdp-queue-filters:${getPb().baseURL}`;
  const [filters, setFilters] = useState(() => readSavedFilters(filterStorageKey));
  const autoFiltered = useRef('');
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
  const [overviewBusy, setOverviewBusy] = useState(false);
  const busy = requestBusy || !!bulkTickets;
  const pending = useRef(false);
  // Foreground reads: only the newest one is shown. The read in flight and the one waiting behind
  // it let ticket and queue choices change while SDP is still answering.
  const runSeq = useRef(0);
  const inFlight = useRef<SdpAccountCommand | undefined>(undefined);
  const waiting = useRef<SdpAccountCommand | undefined>(undefined);
  const selectedRef = useRef('');
  const detailRef = useRef<SdpAccountView['detail']>(undefined);
  const epoch = useRef(0);
  const alive = useRef(true);
  const refreshing = useRef(false);
  const invoke = globalThis.api?.sdpAccount;
  const { search, searchSdp, closeSearch } = useSdpTicketSearch(invoke);
  const available = globalThis.api?.runtime.kind === 'electron' && !!invoke;
  const connected = view?.status === 'connected';
  const profile = useSdpAccountProfile(invoke, connected);
  const openNotifiedTicket = useEffectEvent((id: string) =>
    run({ action: 'readDetail', id, page: 0 }),
  );
  const searchFromRequest = useEffectEvent((query: string) => void searchSdp(query, 0));
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
    else if (request.search) searchFromRequest(request.search);
  }, [connected, request, nativeEditor, editor, requestBusy]);
  useEffect(() => {
    if (!connected && !requestBusy) {
      setEditor(undefined);
      setNativeEditor(undefined);
      setSelected('');
      setOpenedTicket(undefined);
      autoFiltered.current = '';
    }
  }, [connected, requestBusy]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Read when a queue reload finishes, after later renders may have changed them.
  useEffect(() => {
    selectedRef.current = selected;
    detailRef.current = view?.detail;
  });
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
    // A queue reload keeps the open ticket on screen until the new page shows whether it is listed.
    if (command.action === 'readQueue') return;
    setSelected('');
    setOpenedTicket(undefined);
    if (command.action === 'clearCopies') resetSdpNotifications();
  }
  function run(command: SdpAccountCommand) {
    if (!invoke || bulkTickets) return;
    if (pending.current) {
      if (!canWait(inFlight.current, command)) return;
      // The newest choice replaces any older waiting one, and the read in flight is not shown.
      waiting.current = command;
      runSeq.current++;
      epoch.current++;
      setLoadingQueue(command.action === 'readQueue');
      beginRead(command);
      return;
    }
    beginRead(command);
    void execute(command);
  }
  async function execute(command: SdpAccountCommand) {
    const current = ++runSeq.current;
    epoch.current++;
    pending.current = true;
    inFlight.current = command;
    setRequestBusy(true);
    setLoadingQueue(command.action === 'readQueue');
    setError('');
    let next: SdpAccountCommand | undefined;
    try {
      const result = await invoke!(command);
      if (!result.success || !result.data)
        throw new Error(result.error ?? 'SDP could not complete this action.');
      if (alive.current && current === runSeq.current) next = showRead(command, result.data);
    } catch (error) {
      if (alive.current && current === runSeq.current) failRead(command, error);
    } finally {
      finishRead(next);
    }
  }
  /** Shows a read's result; returns the open ticket's re-read when a queue reload keeps it. */
  function showRead(command: SdpAccountCommand, data: SdpAccountView) {
    const { close, reread: next } =
      command.action === 'readQueue'
        ? rereadOpenTicket(selectedRef.current, detailRef.current, data)
        : { close: false };
    if (close) closeTicket(false);
    // A kept ticket shows its last content until it is read again, instead of blanking.
    setView(
      next
        ? (old) => ({ ...data, detail: old?.detail, detailSnapshot: old?.detailSnapshot })
        : data,
    );
    setStale(false);
    setNotice('');
    return next;
  }
  function failRead(command: SdpAccountCommand, error: unknown) {
    setStale(true);
    setError(readFailureMessage(error));
    if (command.action === 'readQueue') closeTicket(false);
  }
  function finishRead(chained?: SdpAccountCommand) {
    pending.current = false;
    inFlight.current = undefined;
    const next = waiting.current ?? chained;
    waiting.current = undefined;
    if (!alive.current) return;
    if (next) {
      void execute(next);
      return;
    }
    setRequestBusy(false);
    setLoadingQueue(false);
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
      account ||
      overviewBusy
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
    runSeq.current++;
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
  const result = visiblePage(view, queue, page, loadingQueue);
  const notes = useSdpQueueNotes(invoke, connected, view);
  const tickets = result?.tickets ?? [];
  const ticket = selectedTicket(view, selected, openedTicket);
  function readQueue(
    nextQueue: SdpQueue,
    nextPage: number,
    nextFilters?: SdpQueueFilters,
    size: SdpPageSize = pageSize,
    order: SdpQueueSort | undefined = sort,
  ) {
    setQueue(nextQueue);
    setPage(nextPage);
    run(queueCommand(nextQueue, nextPage, nextFilters, size, order));
  }
  // Applied filters follow the analyst across queues and pages.
  const load = (nextQueue: SdpQueue, nextPage = 0) => readQueue(nextQueue, nextPage, filters);
  // Remembered filters replace an unfiltered projection (such as the monitor's first page) once
  // per mismatch, so a failed filtered read is not retried in a loop.
  // A page of another size (such as the monitor's default-size first page) is read again too.
  const filtersMismatch = needsReread(result, filters, pageSize, sort);
  const applySavedFilters = useEffectEvent(() => {
    const key = `${queue}:${pageSize}:${sortKey(sort)}:${queueFiltersKey(filters)}`;
    // A read started earlier in this commit (such as a notified ticket) goes first.
    if (pending.current || autoFiltered.current === key) return;
    autoFiltered.current = key;
    load(queue, 0);
  });
  useEffect(() => {
    if (!filtersMismatch) autoFiltered.current = '';
    else if (
      connected &&
      !requestBusy &&
      !selected &&
      !nativeEditor &&
      !editor &&
      !bulkTickets &&
      !account
    )
      applySavedFilters();
  }, [
    filtersMismatch,
    connected,
    requestBusy,
    selected,
    nativeEditor,
    editor,
    bulkTickets,
    account,
  ]);
  function openTicket(id: string, from: HTMLButtonElement | null) {
    openedFrom.current = from;
    run({ action: 'readDetail', id, page: 0 });
  }
  function saveQueues(next: SdpQueue[]) {
    saveSdpQueues(next);
    setQueues(next);
    setManagingQueues(false);
    if (!next.includes(queue)) load(next[0]!);
  }
  function changePageSize(size: SdpPageSize) {
    saveSdpPageSize(size);
    setPageSize(size);
    readQueue(queue, 0, filters, size);
  }
  function changeSort(field: SdpQueueSortField) {
    const next = nextSort(sort, field);
    saveSdpQueueSort(next);
    setSort(next);
    readQueue(queue, 0, filters, pageSize, next);
  }
  function saveRowColors(next: SdpRowColors) {
    saveSdpRowColors(next);
    setRowColors(next);
    setEditingColors(false);
  }
  function closeTicket(restoreFocus = true) {
    if (waiting.current?.action === 'readDetail') waiting.current = undefined;
    setSelected('');
    setOpenedTicket(undefined);
    if (restoreFocus) requestAnimationFrame(() => openedFrom.current?.focus());
  }
  // The open ticket's row, or empty queue space, closes the ticket (Escape does the same).
  function closeFromQueue() {
    if (ticket && !nativeEditor && !overviewBusy) closeTicket();
  }
  const table = useRef<HTMLTableElement>(null);
  const detailLive =
    view?.detailSnapshot?.source === 'live' && !!ticket && view.detail?.id === ticket.id;
  useSdpTicketShortcuts({
    blocked: loadingQueue || !!bulkTickets || !!nativeEditor || !!editor || account || overviewBusy,
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
  // Reads wait their turn instead of locking the queue; drafts and Pick Up still lock it.
  const draftLocked = !!bulkTickets || !!nativeEditor || overviewBusy;
  const queueLocked = draftLocked || !connected;
  const rowsLocked = draftLocked || loadingQueue;
  const emptyMessage = queueEmptyMessage(result, connected && !busy);
  return (
    <div className={`tab-layout tickets-tab ${ticket ? 'has-open-ticket' : ''}`}>
      <TabPageHeader
        title="Tickets"
        metadata={<SdpSignedIn connected={connected} profile={profile} />}
      />
      {showWorkspace && (
        <>
          <TabCommandBar ariaLabel="Live ticket actions">
            {/* Utility commands match the other tabs: bordered, each with its glyph. */}
            <TabCommandGroup kind="utility">
              <TactileButton
                icon={<SdpCommandIcon name="refresh" />}
                disabled={queueLocked}
                onClick={() => load(queue, page)}
              >
                {loadingQueue ? 'Loading…' : 'Refresh Queue'}
              </TactileButton>
              {result && view?.snapshot && (
                <SdpQueueFreshness snapshot={view.snapshot} stale={stale} />
              )}
              <TactileButton
                icon={<SdpCommandIcon name="queues" />}
                disabled={queueLocked}
                onClick={() => setManagingQueues(true)}
              >
                Manage Queues
              </TactileButton>
              <TactileButton
                icon={<SdpCommandIcon name="account" />}
                onClick={() => setAccount(true)}
              >
                Work Account
              </TactileButton>
              {view?.testControls === true && (
                <TactileButton
                  variant="ghost"
                  icon={<SdpCommandIcon name="clear" />}
                  disabled={queueLocked || requestBusy}
                  onClick={() => run({ action: 'clearCopies' })}
                >
                  Clear My Saved SDP Data
                </TactileButton>
              )}
            </TabCommandGroup>
            <TabCommandGroup kind="workflow">
              <SdpBulkControls
                view={view}
                // Its own open dialog leaves Update Selected enabled, so Cancel returns focus to it.
                disabled={(queueLocked && !bulkTickets) || requestBusy}
                ids={bulkIds}
                onSelect={setBulkIds}
                onOpen={setBulkTickets}
              />
              <TactileButton disabled={queueLocked} onClick={() => setEditor({ mode: 'major' })}>
                Major Incident
              </TactileButton>
              {/* Reply in the open ticket is the view's one filled action. */}
              <TactileButton disabled={queueLocked} onClick={() => setEditor({ mode: 'create' })}>
                New Ticket
              </TactileButton>
            </TabCommandGroup>
          </TabCommandBar>
          <SdpQueueNavigation
            queues={queues}
            active={queue}
            searching={!!search}
            locked={queueLocked}
            connected={connected}
            searchText={request?.search}
            onQueue={(name) => {
              closeSearch();
              load(name);
            }}
            onSearch={(query) => void searchSdp(query, 0)}
          />
        </>
      )}

      {request?.ticketId &&
        request.sequence !== handledRequest.current &&
        (nativeEditor || editor) && (
          <p className="ticket-mode-note">
            <output>Finish or cancel your draft to open the notified ticket.</output>
          </p>
        )}
      {editingColors && (
        <SdpRowColorsDialog
          colors={rowColors}
          onSave={saveRowColors}
          onClose={() => setEditingColors(false)}
        />
      )}
      {managingQueues && (
        <SdpQueueManager
          queues={queues}
          onSave={saveQueues}
          onClose={() => setManagingQueues(false)}
        />
      )}
      {bulkTickets && (
        <SdpBulkDialog
          tickets={bulkTickets}
          onClose={(sent) => {
            setBulkTickets(undefined);
            // Cancel keeps the selection to adjust and try again; a sent update clears it.
            if (sent) setBulkIds([]);
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
          {!search && (
            <>
              {result && <SdpQueueOverview queue={result.queue} tickets={result.tickets} />}
              <SdpQueueFilterBar
                applied={filters}
                tickets={tickets}
                disabled={draftLocked}
                connected={connected}
                onApply={(next) => {
                  setFilters(next);
                  saveFilters(filterStorageKey, next);
                  readQueue(queue, 0, next);
                }}
              />
            </>
          )}
          <div className={`ticket-workspace sdp-split-workspace ${ticket ? 'has-ticket' : ''}`}>
            {search && (
              <SdpSearchResults
                search={search}
                selected={selected}
                locked={rowsLocked}
                onOpen={(found, from) => {
                  if (found.id === selected) return closeTicket();
                  setOpenedTicket(found);
                  openTicket(found.id, from);
                }}
                onPage={(next) => void searchSdp(search.query, next)}
                onClose={closeSearch}
              />
            )}
            <SdpQueueList
              hidden={!!search}
              pageSize={pageSize}
              onPageSize={changePageSize}
              sort={sort}
              onSort={changeSort}
              rowColors={rowColors}
              onRowColors={() => setEditingColors(true)}
              result={result}
              queue={queue}
              page={page}
              loading={loadingQueue}
              live={view?.snapshot?.source === 'live'}
              selected={selected}
              bulkIds={bulkIds}
              rowsLocked={rowsLocked}
              pagingLocked={queueLocked}
              hint={!ticket}
              notes={notes}
              emptyMessage={emptyMessage}
              tableRef={table}
              onToggle={toggleBulk}
              onSelectPage={setBulkIds}
              onOpen={(id, from) => (id === selected ? closeTicket() : openTicket(id, from))}
              onBlankClick={closeFromQueue}
              onPage={(next) => load(queue, next)}
            />
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
                onOverviewBusy={setOverviewBusy}
                onRefresh={(nextPage, includeAutoNotifications) =>
                  run({
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
      {account && <SdpAccountPanel profile={profile} onClose={() => setAccount(false)} />}
    </div>
  );
}

function SdpSignedIn({
  connected,
  profile,
}: Readonly<{ connected: boolean; profile?: SdpAccountProfile }>) {
  if (!connected) return null;
  return (
    <span className="tab-page-status">
      <span className="tab-page-status__dot" aria-hidden="true" />
      <span>
        {profile ? (
          <>
            Signed in as <strong>{profile.name}</strong>
          </>
        ) : (
          'Signed in to SDP'
        )}
      </span>
    </span>
  );
}

/**
 * The signed-in person's Zoho name and email, read once per sign-in. Older Relay servers do not
 * offer it, so the name is simply not shown.
 */
function useSdpAccountProfile(
  invoke: BridgeAPI['sdpAccount'],
  connected: boolean,
): SdpAccountProfile | undefined {
  const [profile, setProfile] = useState<{ profile?: SdpAccountProfile }>();
  useEffect(() => {
    if (!invoke || !connected) return;
    let active = true;
    invoke({ action: 'readAccount' })
      .then((result) => {
        if (active) setProfile({ profile: result.success ? result.data?.account : undefined });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      setProfile(undefined);
    };
  }, [invoke, connected]);
  return profile?.profile;
}

/**
 * Which visible live tickets have notes, asked for again when the page or a ticket changes and at
 * most every five minutes otherwise. An older server rejects the read and rows show no notes icon.
 */
function useSdpQueueNotes(
  invoke: BridgeAPI['sdpAccount'],
  connected: boolean,
  view: SdpAccountView | undefined,
): { queue: SdpQueue; page: number; ids: Set<string> } | undefined {
  const [notes, setNotes] = useState<{ queue: SdpQueue; page: number; ids: Set<string> }>();
  const page = connected && view?.snapshot?.source === 'live' ? view.queuePage : undefined;
  const queue = page?.queue;
  const pageNumber = page?.page;
  const tickets = page?.tickets.map((ticket) => ticket.id + '@' + (ticket.updatedAt ?? '')) ?? [];
  // Asked again when a ticket changes, and every five minutes of queue refreshes otherwise.
  const version = page
    ? [Math.floor((view?.snapshot?.fetchedAt ?? 0) / 300_000), ...tickets].join(',')
    : '';
  useEffect(() => {
    if (!invoke || !queue || pageNumber === undefined || !version) return;
    let active = true;
    const timer = setTimeout(() => {
      invoke({ action: 'readQueueNotes', queue, page: pageNumber })
        .then((reply) => {
          const found = reply.success ? reply.data?.queueNotes : undefined;
          if (active && found)
            setNotes({ queue: found.queue, page: found.page, ids: new Set(found.ids) });
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [invoke, queue, pageNumber, version]);
  return notes?.queue === queue && notes?.page === pageNumber ? notes : undefined;
}

/**
 * Queue filters are remembered on this device (like alert rules), so a view such as every status
 * except Closed survives restarts. Search text is session-only.
 */
/** The visible page has other filters, size or order than chosen, so it is read again. */
function needsReread(
  result: SdpAccountView['queuePage'],
  filters: SdpQueueFilters | undefined,
  pageSize: SdpPageSize,
  sort: SdpQueueSort | undefined,
): boolean {
  if (filters && queueFiltersKey(result?.filters) !== queueFiltersKey(filters)) return true;
  if (result && sortKey(result.sort) !== sortKey(sort)) return true;
  return !!result && (result.pageSize ?? SDP_PAGE_SIZE) !== pageSize;
}
function readFailureMessage(error: unknown): string {
  return error instanceof Error && error.message === SDP_SERVER_UPDATE_MESSAGE
    ? 'The Relay server needs an update for added queues, column sorting or pages larger than 50 rows. Sort by Created, choose 50 rows or a default queue, or update the server.'
    : 'Could not load SDP. Check the server connection and your work sign-in, then retry.';
}
const sortKey = (sort: SdpQueueSort | undefined) => (sort ? `${sort.field}:${sort.order}` : '');
/** The column's order on screen; Created is newest first when no column was chosen. */
function sortOrder(sort: SdpQueueSort | undefined, field: SdpQueueSortField) {
  if (sort) return sort.field === field ? sort.order : undefined;
  return field === 'created' ? 'desc' : undefined;
}
/** A column starts A to Z (oldest first for Created), then reverses; newest first is the default. */
function nextSort(
  sort: SdpQueueSort | undefined,
  field: SdpQueueSortField,
): SdpQueueSort | undefined {
  const order: SdpQueueSort['order'] = sortOrder(sort, field) === 'asc' ? 'desc' : 'asc';
  return field === 'created' && order === 'desc' ? undefined : { field, order };
}
function queueCommand(
  queue: SdpQueue,
  page: number,
  filters: SdpQueueFilters | undefined,
  size: SdpPageSize,
  sort: SdpQueueSort | undefined,
): SdpAccountCommand {
  return {
    action: 'readQueue',
    queue,
    page,
    ...(filters ? { filters } : {}),
    // The default size and order are never sent, so servers that predate them keep answering.
    ...(size === SDP_PAGE_SIZE ? {} : { pageSize: size }),
    ...(sort ? { sort } : {}),
  };
}
function readSavedFilters(key: string): SdpQueueFilters | undefined {
  try {
    const parsed = SdpQueueFiltersSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return parsed.success && Object.keys(parsed.data).length ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
function saveFilters(key: string, filters: SdpQueueFilters | undefined) {
  const kept = { ...filters };
  delete kept.search;
  try {
    if (Object.keys(kept).length) localStorage.setItem(key, JSON.stringify(kept));
    else localStorage.removeItem(key);
  } catch {
    // Device storage is unavailable; the filters still apply for this session.
  }
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

function visiblePage(
  view: SdpAccountView | undefined,
  queue: SdpQueue,
  page: number,
  loading: boolean,
) {
  const current = vipLed(view?.queuePage);
  // While another queue or page loads, the previous rows stay (dimmed) instead of emptying.
  if (loading) return current;
  return current?.queue === queue && current.page === page ? current : undefined;
}
/**
 * VIP requesters' tickets lead the page (rows, J/K order and bulk selection follow it), unless the
 * person sorted by a column.
 */
function vipLed(page: SdpAccountView['queuePage']) {
  return !page?.sort && page?.tickets.some((ticket) => ticket.vip)
    ? { ...page, tickets: vipFirst(page.tickets) }
    : page;
}

/**
 * The queue's freshness, directly after Refresh Queue like every live tab's "Updated 4:16 PM".
 * The readout is not a live region, so 30-second refreshes stay quiet; the sr-only output
 * announces only a change between live, retrying and the saved copy.
 */
function SdpQueueFreshness({
  snapshot,
  stale,
}: Readonly<{ snapshot: NonNullable<SdpAccountView['snapshot']>; stale: boolean }>) {
  const saved = snapshot.source === 'outage-cache';
  let note: string | undefined;
  if (saved) note = 'Read only';
  else if (stale) note = 'may be stale';
  return (
    <>
      <Tooltip
        content={`Last synced ${date(snapshot.fetchedAt)} · Saved copy expires ${date(snapshot.expiresAt)}`}
        width="min(320px, 80vw)"
      >
        <time
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus opens the exact-time Tooltip
          tabIndex={0}
          className={`tab-freshness${saved || stale ? ' tab-freshness--stale' : ''}`}
          dateTime={new Date(snapshot.fetchedAt).toISOString()}
        >
          <FreshnessText
            caption={saved ? 'Saved copy from' : 'Updated'}
            at={snapshot.fetchedAt}
            note={note}
          />
        </time>
      </Tooltip>
      <output className="sr-only">{syncLabel(snapshot, stale)}</output>
    </>
  );
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
/** After a queue reload: re-read the open ticket if it is still listed, or close it. */
function rereadOpenTicket(
  id: string,
  detail: SdpAccountView['detail'],
  data: SdpAccountView,
): { close: boolean; reread?: SdpAccountCommand } {
  if (!id) return { close: false };
  if (!data.queuePage?.tickets.some((item) => item.id === id)) return { close: true };
  const same = detail?.id === id;
  return {
    close: false,
    reread: {
      action: 'readDetail',
      id,
      page: same ? detail.page : 0,
      ...(same && detail.includeAutoNotifications ? { includeAutoNotifications: true } : {}),
    },
  };
}

/**
 * Ticket and queue reads may wait behind one another (the newest choice wins). A ticket cannot be
 * chosen while a queue page loads, because its row may not be on the page that arrives.
 */
function canWait(running: SdpAccountCommand | undefined, next: SdpAccountCommand): boolean {
  const read = (command?: SdpAccountCommand) =>
    command?.action === 'readQueue' || command?.action === 'readDetail';
  if (!read(running) || !read(next)) return false;
  return !(running!.action === 'readQueue' && next.action === 'readDetail');
}

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
  // A queue reload keeps the open ticket's content until the reload decides whether it stays open.
  if (command.action === 'readQueue') return old;
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
  // Without an open ticket, J/K move from the focused row, whether its link or its checkbox.
  const focused = document.activeElement?.closest('tr')?.querySelector('button.ticket-row-open');
  const anchor = openId
    ? tickets.findIndex((item) => item.id === openId)
    : rows.indexOf(focused as HTMLButtonElement);
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
  const vip = tickets.filter((item) => item.vip).length;
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
      {vip > 0 && (
        <div className="sdp-reply-count sdp-vip-count">
          <span>VIP requesters</span>
          <strong>{vip}</strong>
        </div>
      )}
      <div className="sdp-reply-count">
        <span>Unread replies</span>
        <strong>{tickets.filter((item) => item.replyUnread).length}</strong>
      </div>
    </section>
  );
}

/** The queue table. Empty space in it closes the open ticket (a pointer shortcut). */
function SdpQueueList({
  hidden,
  pageSize,
  onPageSize,
  sort,
  onSort,
  rowColors,
  onRowColors,
  onSelectPage,
  result,
  queue,
  page,
  loading,
  live,
  selected,
  bulkIds,
  rowsLocked,
  pagingLocked,
  hint,
  notes,
  emptyMessage,
  tableRef,
  onToggle,
  onOpen,
  onBlankClick,
  onPage,
}: Readonly<{
  result: SdpAccountView['queuePage'];
  queue: SdpQueue;
  page: number;
  loading: boolean;
  live: boolean;
  selected: string;
  bulkIds: string[];
  rowsLocked: boolean;
  pagingLocked: boolean;
  hint: boolean;
  notes?: { queue: SdpQueue; page: number; ids: Set<string> };
  emptyMessage?: string;
  tableRef: RefObject<HTMLTableElement | null>;
  /** True while SDP-wide search results replace the queue; the queue keeps its state. */
  hidden: boolean;
  pageSize: SdpPageSize;
  onPageSize: (size: SdpPageSize) => void;
  sort?: SdpQueueSort;
  onSort: (field: SdpQueueSortField) => void;
  rowColors: SdpRowColors;
  onRowColors: () => void;
  onSelectPage: (ids: string[]) => void;
  onToggle: (id: string, checked: boolean) => void;
  onOpen: (id: string, from: HTMLButtonElement) => void;
  onBlankClick: () => void;
  onPage: (page: number) => void;
}>) {
  const tickets = result?.tickets ?? [];
  const checkedCount = tickets.filter((item) => bulkIds.includes(item.id)).length;
  const sortProps = { sort, disabled: pagingLocked, onSort };
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a pointer shortcut; Escape, Back to Queue and the open row do the same from the keyboard.
    <section
      className="ticket-list"
      hidden={hidden}
      aria-label="Live tickets in queue"
      onClick={(event: MouseEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (!target.closest('button, a, input, label, select, textarea')) onBlankClick();
      }}
    >
      <div className="ticket-list-caption">
        <span>{loading ? `Loading ${queue} queue…` : queueCaption(result)}</span>
        <div className="sdp-caption-tools">
          {hint && tickets.length > 0 && (
            <span className="sdp-shortcut-hint">J/K move · Enter opens · R replies</span>
          )}
          <SdpRowColorLegend tickets={tickets} colors={rowColors} />
          <TactileButton size="xs" variant="ghost" onClick={onRowColors}>
            Row Colors
          </TactileButton>
        </div>
      </div>
      <table
        className={`sdp-live-table ${loading ? 'is-loading' : ''}`}
        aria-busy={loading || undefined}
        ref={tableRef}
      >
        <colgroup>
          <col className="sdp-live-subject-column" />
          <col className="sdp-live-priority-column" />
          <col className="sdp-live-status-column" />
          <col className="sdp-live-technician-column" />
          <col className="sdp-live-reply-column" />
          <col className="sdp-live-created-column" />
        </colgroup>
        <thead>
          <tr>
            <th aria-sort={ariaSort(sortOrder(sort, 'number'))}>
              <div className="sdp-row-main">
                <SelectPageCheckbox
                  total={tickets.length}
                  checked={checkedCount}
                  disabled={rowsLocked || !live || !tickets.length}
                  onChange={(all) =>
                    onSelectPage(all ? tickets.slice(0, SDP_BULK_MAX).map((item) => item.id) : [])
                  }
                />
                <SortButton field="number" {...sortProps}>
                  Ticket
                </SortButton>
              </div>
            </th>
            <SortHeader field="priority" {...sortProps}>
              Priority
            </SortHeader>
            <SortHeader field="status" {...sortProps}>
              Status
            </SortHeader>
            <SortHeader field="technician" {...sortProps}>
              Technician
            </SortHeader>
            <th>Last reply</th>
            <SortHeader field="created" {...sortProps}>
              Created
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {tickets.map((item) => (
            <SdpQueueRow
              key={item.id}
              item={item}
              hasNotes={notes && notes.queue === item.group ? notes.ids.has(item.id) : undefined}
              tint={rowTint(item, rowColors)}
              selected={item.id === selected}
              checked={bulkIds.includes(item.id)}
              selectDisabled={
                rowsLocked ||
                !live ||
                (!bulkIds.includes(item.id) && bulkIds.length >= SDP_BULK_MAX)
              }
              openDisabled={rowsLocked}
              onToggle={(checked) => onToggle(item.id, checked)}
              onOpen={(from) => onOpen(item.id, from)}
            />
          ))}
        </tbody>
      </table>
      {emptyMessage && <p className="ticket-list-caption">{emptyMessage}</p>}
      <div className="ticket-actions sdp-queue-pagination">
        <TactileButton
          size="sm"
          disabled={pagingLocked || page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </TactileButton>
        <TactileButton
          size="sm"
          disabled={pagingLocked || !result?.hasMore || page >= 19}
          onClick={() => onPage(page + 1)}
        >
          Next
        </TactileButton>
        <span className="sdp-page-number">Page {page + 1}</span>
        <label className="sdp-page-size">
          Rows per page
          <select
            value={pageSize}
            disabled={pagingLocked}
            onChange={(event) => onPageSize(Number(event.target.value) as SdpPageSize)}
          >
            {SDP_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

/** Queue tabs in the person's order, then SDP-wide search. */
function SdpQueueNavigation({
  queues,
  active,
  searching,
  locked,
  connected,
  searchText,
  onQueue,
  onSearch,
}: Readonly<{
  queues: readonly SdpQueue[];
  active: SdpQueue;
  /** No tab is current while SDP-wide search results replace the queue. */
  searching: boolean;
  locked: boolean;
  connected: boolean;
  searchText?: string;
  onQueue: (queue: SdpQueue) => void;
  onSearch: (query: string) => void;
}>) {
  return (
    <div className="sdp-queue-navigation">
      <div className="sdp-queue-tabs">
        <nav className="ticket-queues tab-strip" aria-label="Live SDP queues">
          {queues.map((name) => (
            <button
              key={name}
              type="button"
              className="tab-strip__tab"
              aria-current={name === active && !searching ? 'page' : undefined}
              disabled={locked}
              onClick={() => onQueue(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <SdpSearchForm
          initial={searchText}
          current={searching}
          disabled={!connected}
          onSearch={onSearch}
        />
      </div>
    </div>
  );
}

/** Checks every row on the page; mixed when only some are checked. */
type SortProps = Readonly<{
  field: SdpQueueSortField;
  sort?: SdpQueueSort;
  disabled: boolean;
  onSort: (field: SdpQueueSortField) => void;
  children: ReactNode;
}>;
/** A column header that sorts the queue in SDP; aria-sort on its cell announces the order. */
const ariaSort = (order?: 'asc' | 'desc') =>
  order && (order === 'asc' ? ('ascending' as const) : ('descending' as const));
function SortHeader(props: SortProps) {
  const order = sortOrder(props.sort, props.field);
  return (
    <th aria-sort={ariaSort(order)}>
      <SortButton {...props} />
    </th>
  );
}
function SortButton({ field, sort, disabled, onSort, children }: SortProps) {
  const order = sortOrder(sort, field);
  return (
    <button
      type="button"
      className={`sdp-sort ${order ? 'is-sorted' : ''}`}
      disabled={disabled}
      onClick={() => onSort(field)}
    >
      {children}
      <svg className="sdp-sort-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d={order === 'asc' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
      </svg>
    </button>
  );
}

function SelectPageCheckbox({
  total,
  checked,
  disabled,
  onChange,
}: Readonly<{
  total: number;
  checked: number;
  disabled: boolean;
  onChange: (all: boolean) => void;
}>) {
  const all = total > 0 && checked === total;
  return (
    <label className="sdp-select-ticket">
      <input
        type="checkbox"
        aria-label="Select all tickets on this page"
        checked={all}
        ref={(input) => {
          if (input) input.indeterminate = checked > 0 && !all;
        }}
        disabled={disabled}
        onChange={() => onChange(!all)}
      />
    </label>
  );
}

/** SDP's list-view icons: the conversation envelope (colored by who wrote last) and notes. */
function SdpRowFlags({
  conversation,
  hasNotes,
}: Readonly<{ conversation?: SdpConversationState; hasNotes?: boolean }>) {
  if (!conversation && hasNotes === undefined) return null;
  return (
    <span className="sdp-row-flags" aria-hidden="true">
      {conversation && (
        <span className={`sdp-row-flag is-${conversation.tone}`} title={conversation.label}>
          <SdpIcon name="mail" />
          {conversation.waiting && (
            <span className="sdp-row-flag-count">{conversation.waiting}</span>
          )}
        </span>
      )}
      {hasNotes !== undefined && (
        <span
          className={`sdp-row-flag ${hasNotes ? 'has-notes' : ''}`}
          title={hasNotes ? 'Has notes' : 'No notes'}
        >
          <SdpIcon name="note" />
        </span>
      )}
    </span>
  );
}

function SdpQueueRow({
  item,
  hasNotes,
  tint,
  selected,
  checked,
  selectDisabled,
  openDisabled,
  onToggle,
  onOpen,
}: Readonly<{
  item: SdpQueueTicket;
  hasNotes?: boolean;
  /** A request-type color; the type joins the row's accessible name so color is not the only cue. */
  tint?: CSSProperties;
  selected: boolean;
  checked: boolean;
  selectDisabled: boolean;
  openDisabled: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: (from: HTMLButtonElement) => void;
}>) {
  const subject = item.subject || 'No subject';
  const conversation = conversationState(item);
  const flags = [item.vip ? 'VIP requester' : '', conversation?.label, hasNotes ? 'has notes' : '']
    .filter(Boolean)
    .join(', ');
  const name = `Open ticket ${item.number}: ${subject}`;
  return (
    <tr
      className={[selected ? 'sdp-selected-row' : '', tint ? 'sdp-tinted-row' : '']
        .filter(Boolean)
        .join(' ')}
      style={tint}
    >
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
            aria-label={flags ? `${name}. ${flags}` : name}
            disabled={openDisabled}
            onClick={(event) => onOpen(event.currentTarget)}
          >
            <span className="ticket-id">#{item.number}</span>
            {item.vip && <VipBadge />}
            <SdpRowFlags conversation={conversation} hasNotes={hasNotes} />
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
        <CreatedTime createdAt={item.createdAt} />
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
