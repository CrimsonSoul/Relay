import { SdpBulkDialog, SdpBulkControls } from './SdpBulkDialog';
import { SdpQueueManager } from './SdpQueueManager';
import { SdpSearchForm, SdpSearchResults, useSdpTicketSearch } from './SdpTicketSearch';
import {
  readSdpPageSize,
  readSdpQueueSort,
  readSdpQueues,
  readSdpRowColors,
  readSdpRowStrength,
  readSdpTicketExpanded,
  saveSdpPageSize,
  saveSdpQueueSort,
  saveSdpQueues,
  saveSdpRowColors,
  saveSdpRowStrength,
  saveSdpTicketExpanded,
  type SdpPageSize,
  type SdpRowColors,
  type SdpRowStrength,
} from './sdpQueuePreferences';
import { rowTint, SdpRowColorLegend, SdpRowColorsDialog, VIBRANT_ROWS } from './SdpRowColors';
import { queueFiltersKey, SdpQueueFilterBar } from './SdpQueueFilterBar';
import { CreatedTime, SdpPriorityFlag, SdpVipFlag, vipFirst } from './sdpQueueFormat';
import { SdpRowQuickEdit } from './SdpRowQuickEdit';
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
import { SdpTicketWorkspace, ticketClosable } from './SdpTicketWorkspace';
import { formatOpsTime } from '../../utils/opsTime';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
/** While Tickets is visible, the current queue page and open ticket are read again this often. */
const VISIBLE_REFRESH_MS = 120_000;
const date = (value: number | null): string =>
  value === null ? 'Not set' : new Date(value).toLocaleString();

/**
 * N, E and C for an open ticket whose live detail is idle; C only while SDP still lets it be
 * closed.
 */
function ticketActionKeys<T extends { status: string }>(
  { ticket, live, busy }: { ticket?: T; live: boolean; busy: boolean },
  open: (mode: 'note' | 'close', ticket: T) => void,
  edit: () => void,
) {
  if (!ticket || !live || busy) return {};
  return {
    onNote: () => open('note', ticket),
    onEdit: edit,
    onCloseTicket: ticketClosable(ticket.status) ? () => open('close', ticket) : undefined,
  };
}

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
  const [rowStrength, setRowStrength] = useState(readSdpRowStrength);
  const [editingColors, setEditingColors] = useState(false);
  const [managingQueues, setManagingQueues] = useState(false);
  const filterStorageKey = `relay:sdp-queue-filters:${getPb().baseURL}`;
  const [filters, setFilters] = useState(() => readSavedFilters(filterStorageKey));
  const autoFiltered = useRef('');
  const [selected, setSelected] = useState('');
  // Rows from the queue's earlier pages, kept above the newest page as Load more adds pages.
  const [earlier, setEarlier] = useState<LoadedRows>();
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
  // A queue-row change in flight holds the queue in place, as an overview change or Pick Up does.
  const [rowBusy, setRowBusy] = useState(false);
  const [ticketExpanded, toggleExpanded] = useTicketExpanded();
  const busy = requestBusy || !!bulkTickets;
  const connected = view?.status === 'connected';
  const recent = useRecentQueuePages(connected);
  const pending = useRef(false);
  // Foreground reads: only the newest one is shown. The read in flight and the one waiting behind
  // it let ticket and queue choices change while SDP is still answering.
  const runSeq = useRef(0);
  const inFlight = useRef<SdpAccountCommand | undefined>(undefined);
  const waiting = useRef<SdpAccountCommand | undefined>(undefined);
  const selectedRef = useRef('');
  const detailRef = useRef<SdpAccountView['detail']>(undefined);
  const epoch = useRef(0);
  // The queue page on screen, which a failed queue read returns to.
  const shownPage = useRef<SdpAccountView['queuePage']>(undefined);
  const refreshing = useRef(false);
  const invoke = globalThis.api?.sdpAccount;
  const { search, searchSdp, closeSearch } = useSdpTicketSearch(invoke);
  const available = globalThis.api?.runtime.kind === 'electron' && !!invoke;
  const profile = useSdpAccountProfile(invoke, connected);
  const openNotifiedTicket = useEffectEvent((id: string) =>
    run({ action: 'readDetail', id, page: 0 }),
  );
  const searchFromRequest = useEffectEvent((query: string) => void searchSdp(query, 0));
  const endSearch = useEffectEvent(() => closeSearch());
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
      // Results from the signed-out account are not shown to the next one.
      endSearch();
      setEditor(undefined);
      setNativeEditor(undefined);
      setSelected('');
      setOpenedTicket(undefined);
      autoFiltered.current = '';
    }
  }, [connected, requestBusy]);
  // Read when a queue reload finishes, after later renders may have changed them. A hidden tab
  // keeps its reads: hiding runs effect cleanups, so nothing here depends on one.
  useEffect(() => {
    selectedRef.current = selected;
    detailRef.current = view?.detail;
    shownPage.current = view?.queuePage;
  });
  function toggleBulk(id: string, checked: boolean) {
    setBulkIds((ids) => (checked ? [...ids, id] : ids.filter((value) => value !== id)));
  }
  function beginRead(command: SdpAccountCommand) {
    recent.request(command);
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
    // Load more adds rows below the checked ones; any other queue read starts a new selection.
    if (command.action !== 'readQueue' || !command.page) setBulkIds([]);
    // A queue reload keeps the open ticket on screen until the new page shows whether it is listed.
    if (command.action === 'readQueue') return;
    setSelected('');
    setOpenedTicket(undefined);
    if (command.action === 'clearCopies') {
      closeSearch();
      resetSdpNotifications();
      recent.clear();
    }
  }
  /** Starts or queues a read; false when it was refused (a bulk draft, or a busy change). */
  function run(command: SdpAccountCommand): boolean {
    if (!invoke || bulkTickets) return false;
    if (pending.current) {
      if (!canWait(inFlight.current, command)) return false;
      // The newest choice replaces any older waiting one, and the read in flight is not shown.
      waiting.current = command;
      runSeq.current++;
      epoch.current++;
      setLoadingQueue(command.action === 'readQueue');
      beginRead(command);
      return true;
    }
    beginRead(command);
    void execute(command);
    return true;
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
      if (current === runSeq.current) next = showRead(command, result.data);
    } catch (error) {
      if (current === runSeq.current) failRead(command, error);
    } finally {
      finishRead(next);
    }
  }
  /** Shows a read's result; returns the open ticket's re-read when a queue reload keeps it. */
  function showRead(command: SdpAccountCommand, data: SdpAccountView) {
    recent.remember(command, data);
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
    if (command.action !== 'readQueue') return;
    closeTicket(false);
    // The rows on screen stay listed (a failed Load More keeps the loaded pages).
    const shown = shownPage.current;
    if (shown) {
      setQueue(shown.queue);
      setPage(shown.page);
    }
  }
  function finishRead(chained?: SdpAccountCommand) {
    pending.current = false;
    inFlight.current = undefined;
    const next = waiting.current ?? chained;
    waiting.current = undefined;
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
      overviewBusy ||
      rowBusy
    )
      return;
    const current = ++epoch.current;
    refreshing.current = true;
    try {
      const result = await invoke({ action: 'refreshVisible' });
      if (current === epoch.current && result.success && result.data) {
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
    }, VISIBLE_REFRESH_MS);
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
  const preview = recent.pending(view?.queuePage, loadingQueue);
  const pageResult = visiblePage(view, queue, page, loadingQueue, preview);
  const pageNotes = useSdpQueueNotes(invoke, connected, view);
  const { result, notes } = withLoadedRows(
    earlier,
    // Earlier rows belong to this queue view and show only past its first page.
    page,
    pageKey(queue, 0, filters, pageSize, sort),
    pageResult,
    pageNotes,
  );
  const tickets = result?.tickets ?? [];
  const ticket = selectedTicket(view, selected, openedTicket);
  function readQueue(
    nextQueue: SdpQueue,
    nextPage: number,
    nextFilters?: SdpQueueFilters,
    size: SdpPageSize = pageSize,
    order: SdpQueueSort | undefined = sort,
  ) {
    if (!run(queueCommand(nextQueue, nextPage, nextFilters, size, order))) return;
    setQueue(nextQueue);
    setPage(nextPage);
  }
  // Applied filters follow the analyst across queues and pages.
  const load = (nextQueue: SdpQueue, nextPage = 0) => readQueue(nextQueue, nextPage, filters);
  /** Keeps every loaded row and reads the next page below them. */
  function loadMore() {
    setEarlier({
      key: pageKey(queue, 0, filters, pageSize, sort),
      tickets,
      notes: noteIds(notes),
    });
    load(queue, page + 1);
  }
  // Remembered filters replace an unfiltered projection (such as an older server's monitor page)
  // once per mismatch, so a failed filtered read is not retried in a loop. A page of another size
  // (such as an older server's default-size monitor page) is read again too.
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
  function changeSort(next?: SdpQueueSort) {
    saveSdpQueueSort(next);
    setSort(next);
    readQueue(queue, 0, filters, pageSize, next);
  }
  function saveRowColors(next: SdpRowColors, strength: SdpRowStrength) {
    saveSdpRowColors(next);
    saveSdpRowStrength(strength);
    setRowColors(next);
    setRowStrength(strength);
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
    if (ticket && !nativeEditor && !overviewBusy && !rowBusy) closeTicket();
  }
  const list = useRef<HTMLUListElement>(null);
  const detailLive =
    view?.detailSnapshot?.source === 'live' && !!ticket && view.detail?.id === ticket.id;
  useSdpTicketShortcuts({
    blocked:
      loadingQueue ||
      !!bulkTickets ||
      !!nativeEditor ||
      !!editor ||
      account ||
      overviewBusy ||
      rowBusy,
    onMove(step) {
      // Search results replace the queue, whose hidden rows are not stepped through.
      if (search) return;
      const rows = [
        ...(list.current?.querySelectorAll<HTMLButtonElement>('button.ticket-row-open') ?? []),
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
    ...ticketActionKeys(
      { ticket, live: detailLive, busy },
      (mode, open) => setEditor({ mode, ticket: open }),
      () => setNativeEditor('edit'),
    ),
    onBack: ticket ? closeTicket : undefined,
    onExpand: ticket ? toggleExpanded : undefined,
  });
  const showWorkspace = connected || !!result || !!ticket || !!editor || !!nativeEditor;
  // Reads wait their turn instead of locking the queue; drafts and Pick Up still lock it.
  const draftLocked = !!bulkTickets || !!nativeEditor || overviewBusy || rowBusy;
  const queueLocked = draftLocked || !connected;
  const rowsLocked = draftLocked || loadingQueue;
  const emptyMessage = queueEmptyMessage(result, connected && !busy);
  return (
    <div className={ticketsTabClass(!!ticket, ticketExpanded)}>
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
                onClick={() => load(queue, 0)}
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
                tickets={tickets}
                live={view?.snapshot?.source === 'live'}
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
          strength={rowStrength}
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
            filters={
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
            }
            pageSize={pageSize}
            onPageSize={changePageSize}
            sort={sort}
            onSort={changeSort}
            rowColors={rowColors}
            rowStrength={rowStrength}
            onRowColors={() => setEditingColors(true)}
            result={result}
            queue={queue}
            page={page}
            loading={loadingQueue}
            previewing={!!preview}
            live={view?.snapshot?.source === 'live'}
            selected={selected}
            bulkIds={bulkIds}
            rowsLocked={rowsLocked}
            pagingLocked={queueLocked}
            notes={notes}
            emptyMessage={emptyMessage}
            listRef={list}
            onToggle={toggleBulk}
            onSelectPage={setBulkIds}
            onOpen={(id, from) => (id === selected ? closeTicket() : openTicket(id, from))}
            onBlankClick={closeFromQueue}
            onLoadMore={loadMore}
            onRowBusy={setRowBusy}
            onResult={applyResult}
          />
          {!ticket && <SdpTicketPlaceholder count={tickets.length} />}
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
              expanded={ticketExpanded}
              onExpand={toggleExpanded}
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
  const [profile, setProfile] = useState<SdpAccountProfile>();
  // Hiding Tickets runs effect cleanups, so the read is guarded per sign-in rather than cancelled.
  const read = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    if (!invoke || !connected) {
      read.current = false;
      sequence.current++;
      setProfile(undefined);
      return;
    }
    if (read.current) return;
    read.current = true;
    const current = ++sequence.current;
    invoke({ action: 'readAccount' })
      .then((result) => {
        if (current === sequence.current)
          setProfile(result.success ? result.data?.account : undefined);
      })
      .catch(() => undefined);
  }, [invoke, connected]);
  return profile;
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
/** An expanded ticket fills the tab; the choice stays for the next ticket on this device. */
function useTicketExpanded() {
  const [expanded, setExpanded] = useState(readSdpTicketExpanded);
  function toggle() {
    setExpanded(!expanded);
    saveSdpTicketExpanded(!expanded);
  }
  return [expanded, toggle] as const;
}
const ticketsTabClass = (open: boolean, expanded: boolean) =>
  [
    'tab-layout tickets-tab',
    open ? 'has-open-ticket' : '',
    open && expanded ? 'is-ticket-expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');
/** The detail pane before a ticket is open: what to do, never an empty box. */
function SdpTicketPlaceholder({ count }: Readonly<{ count: number }>) {
  return (
    <section className="sdp-ticket-placeholder" aria-label="Ticket">
      <h3>{count ? 'Select a ticket' : 'No ticket open'}</h3>
      <p>
        {count
          ? 'Its conversation, work and details open here.'
          : 'Tickets you open from the queue or SDP search appear here.'}
      </p>
    </section>
  );
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

type QueuePage = NonNullable<SdpAccountView['queuePage']>;
const RECENT_PAGES = 12;
const pageKey = (
  queue: string,
  page: number,
  filters: SdpQueueFilters | undefined,
  size: number | undefined,
  sort: SdpQueueSort | undefined,
) => JSON.stringify([queue, page, size ?? SDP_PAGE_SIZE, sortKey(sort), queueFiltersKey(filters)]);
const keyOf = (page?: QueuePage) =>
  page ? pageKey(page.queue, page.page, page.filters, page.pageSize, page.sort) : '';
/**
 * The last live page of each queue view read this session, kept in memory only. Switching back to
 * a queue shows its earlier rows (dimmed and locked) until the fresh read replaces them, instead of
 * the previous queue's rows. Signing out or clearing saved copies forgets them.
 */
function useRecentQueuePages(connected: boolean) {
  const pages = useRef(new Map<string, QueuePage>());
  const [requested, setRequested] = useState<QueuePage>();
  useEffect(() => {
    if (connected) return;
    pages.current.clear();
    setRequested(undefined);
  }, [connected]);
  return {
    /** Picks the remembered page, if any, for a read about to start. */
    request(command: SdpAccountCommand) {
      setRequested(
        command.action === 'readQueue'
          ? pages.current.get(
              pageKey(command.queue, command.page, command.filters, command.pageSize, command.sort),
            )
          : undefined,
      );
    },
    remember(command: SdpAccountCommand, data: SdpAccountView) {
      if (command.action !== 'readQueue' || data.snapshot?.source !== 'live') return;
      const key = keyOf(data.queuePage);
      if (!key) return;
      pages.current.delete(key);
      pages.current.set(key, data.queuePage!);
      if (pages.current.size > RECENT_PAGES)
        pages.current.delete(pages.current.keys().next().value!);
    },
    /** The remembered page to show while its read runs, unless the view already holds that page. */
    pending(current: QueuePage | undefined, loading: boolean) {
      return loading && requested && keyOf(requested) !== keyOf(current) ? requested : undefined;
    },
    clear() {
      pages.current.clear();
      setRequested(undefined);
    },
  };
}

function visiblePage(
  view: SdpAccountView | undefined,
  queue: SdpQueue,
  page: number,
  loading: boolean,
  preview?: QueuePage,
) {
  if (preview) return vipLed(preview);
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
  const focused = document.activeElement
    ?.closest('.sdp-queue-row')
    ?.querySelector('button.ticket-row-open');
  const anchor = openId
    ? tickets.findIndex((item) => item.id === openId)
    : rows.indexOf(focused as HTMLButtonElement);
  let next = anchor + step;
  if (anchor < 0) next = step === 1 ? 0 : rows.length - 1;
  const row = rows[next];
  const target = tickets[next];
  return row && target ? { id: target.id, row } : undefined;
}

/**
 * The queue column: filters, a one-row heading (select all, order, count, Row Colors), then one
 * three-line row per ticket. Empty space in it closes the open ticket (a pointer shortcut).
 */
function SdpQueueList({
  hidden,
  filters,
  pageSize,
  onPageSize,
  sort,
  onSort,
  rowColors,
  rowStrength,
  onRowColors,
  onSelectPage,
  result,
  queue,
  page,
  loading,
  previewing,
  live,
  selected,
  bulkIds,
  rowsLocked,
  pagingLocked,
  notes,
  emptyMessage,
  listRef,
  onToggle,
  onOpen,
  onBlankClick,
  onLoadMore,
  onRowBusy,
  onResult,
}: Readonly<{
  result: SdpAccountView['queuePage'];
  queue: SdpQueue;
  page: number;
  loading: boolean;
  /** The rows are this queue page's from earlier in the session, shown while it loads again. */
  previewing: boolean;
  live: boolean;
  selected: string;
  bulkIds: string[];
  rowsLocked: boolean;
  pagingLocked: boolean;
  notes?: { queue: SdpQueue; page: number; ids: Set<string> };
  emptyMessage?: string;
  listRef: RefObject<HTMLUListElement | null>;
  /** True while SDP-wide search results replace the queue; the queue keeps its state. */
  hidden: boolean;
  /** The queue filters, shown at the top of the column. */
  filters?: ReactNode;
  pageSize: SdpPageSize;
  onPageSize: (size: SdpPageSize) => void;
  sort?: SdpQueueSort;
  onSort: (sort?: SdpQueueSort) => void;
  rowColors: SdpRowColors;
  rowStrength: SdpRowStrength;
  onRowColors: () => void;
  onSelectPage: (ids: string[]) => void;
  onToggle: (id: string, checked: boolean) => void;
  onOpen: (id: string, from: HTMLButtonElement) => void;
  onBlankClick: () => void;
  onLoadMore: () => void;
  onRowBusy: (busy: boolean) => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const tickets = result?.tickets ?? [];
  const checkedCount = tickets.filter((item) => bulkIds.includes(item.id)).length;
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a pointer shortcut; Escape, Back to Queue and the open row do the same from the keyboard.
    <section
      className="ticket-list sdp-queue"
      hidden={hidden}
      aria-label="Live tickets in queue"
      onClick={(event: MouseEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        // A row's change picker is portaled, but its events still bubble through this section.
        if (!target.closest('button, a, input, label, select, textarea, form, [role="dialog"]'))
          onBlankClick();
      }}
    >
      {filters}
      <div className="sdp-queue-heading">
        <SelectPageCheckbox
          total={tickets.length}
          checked={checkedCount}
          disabled={rowsLocked || !live || !tickets.length}
          onChange={(all) =>
            onSelectPage(all ? tickets.slice(0, SDP_BULK_MAX).map((item) => item.id) : [])
          }
        />
        <SdpQueueSortSelect sort={sort} disabled={pagingLocked} onSort={onSort} />
        <span className="sdp-queue-caption">
          {loading ? loadingCaption(queue, previewing) : queueCaption(result)}
        </span>
        <TactileButton size="xs" variant="ghost" onClick={onRowColors}>
          Row Colors
        </TactileButton>
      </div>
      <SdpRowColorLegend tickets={tickets} colors={rowColors} />
      <ul
        className={[
          'sdp-queue-rows',
          loading ? 'is-loading' : '',
          rowStrength === 'vibrant' ? VIBRANT_ROWS : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-busy={loading || undefined}
        aria-label={`${queue} tickets`}
        ref={listRef}
      >
        {tickets.map((item) => (
          <SdpQueueRow
            key={item.id}
            item={item}
            hasNotes={notes?.queue === item.group ? notes.ids.has(item.id) : undefined}
            tint={rowTint(item, rowColors)}
            selected={item.id === selected}
            checked={bulkIds.includes(item.id)}
            selectDisabled={
              rowsLocked || !live || (!bulkIds.includes(item.id) && bulkIds.length >= SDP_BULK_MAX)
            }
            openDisabled={rowsLocked}
            editable={live && !rowsLocked}
            onToggle={(checked) => onToggle(item.id, checked)}
            onOpen={(from) => onOpen(item.id, from)}
            onBusy={onRowBusy}
            onResult={onResult}
          />
        ))}
      </ul>
      {emptyMessage && <p className="sdp-queue-empty">{emptyMessage}</p>}
      <div className="ticket-actions sdp-queue-pagination">
        {result?.hasMore && page < 19 && (
          <TactileButton size="sm" disabled={pagingLocked} onClick={onLoadMore}>
            {loading && page > 0 ? 'Loading…' : `Load ${pageSize} More`}
          </TactileButton>
        )}
        <label className="sdp-page-size">
          <span>Rows per load</span>
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

/** Orders SDP can sort the queue by; newest first is the default and is never sent. */
const QUEUE_SORT_OPTIONS: readonly { value: string; label: string; sort?: SdpQueueSort }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'created-asc', label: 'Oldest first', sort: { field: 'created', order: 'asc' } },
  {
    value: 'number-desc',
    label: 'Ticket number, high to low',
    sort: { field: 'number', order: 'desc' },
  },
  {
    value: 'number-asc',
    label: 'Ticket number, low to high',
    sort: { field: 'number', order: 'asc' },
  },
  { value: 'priority-asc', label: 'Priority, A to Z', sort: { field: 'priority', order: 'asc' } },
  { value: 'priority-desc', label: 'Priority, Z to A', sort: { field: 'priority', order: 'desc' } },
  { value: 'status-asc', label: 'Status, A to Z', sort: { field: 'status', order: 'asc' } },
  { value: 'status-desc', label: 'Status, Z to A', sort: { field: 'status', order: 'desc' } },
  {
    value: 'technician-asc',
    label: 'Technician, A to Z',
    sort: { field: 'technician', order: 'asc' },
  },
  {
    value: 'technician-desc',
    label: 'Technician, Z to A',
    sort: { field: 'technician', order: 'desc' },
  },
];
const sortValue = (sort?: SdpQueueSort) => (sort ? `${sort.field}-${sort.order}` : 'newest');

/** The queue's order, a compact select like the Problems queue's. */
function SdpQueueSortSelect({
  sort,
  disabled,
  onSort,
}: Readonly<{ sort?: SdpQueueSort; disabled: boolean; onSort: (sort?: SdpQueueSort) => void }>) {
  return (
    <label className="sdp-queue-sort">
      <span className="sr-only">Sort queue</span>
      <select
        value={sortValue(sort)}
        disabled={disabled}
        onChange={(event) =>
          onSort(QUEUE_SORT_OPTIONS.find((option) => option.value === event.target.value)?.sort)
        }
      >
        {QUEUE_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
  // Past the bulk limit, a full selection is the first SDP_BULK_MAX rows; the next click clears it.
  const full = total > 0 && checked >= Math.min(total, SDP_BULK_MAX);
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
        onChange={() => onChange(!full)}
      />
    </label>
  );
}

/**
 * SDP's list-view icons: priority bars, the conversation envelope (colored by who wrote last) and
 * notes. The VIP marker joins them only when the row has no requester name to sit beside.
 */
function SdpRowFlags({
  vip,
  priority,
  conversation,
  hasNotes,
}: Readonly<{
  vip?: true;
  priority: string;
  conversation?: SdpConversationState;
  hasNotes?: boolean;
}>) {
  if (!vip && !priority && !conversation && hasNotes === undefined) return null;
  return (
    <span className="sdp-row-flags" aria-hidden="true">
      {vip && <SdpVipFlag />}
      {priority && <SdpPriorityFlag priority={priority} />}
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
  editable,
  onToggle,
  onOpen,
  onBusy,
  onResult,
}: Readonly<{
  item: SdpQueueTicket;
  hasNotes?: boolean;
  /** A request-type color; the type joins the row's accessible name so color is not the only cue. */
  tint?: CSSProperties;
  selected: boolean;
  checked: boolean;
  selectDisabled: boolean;
  openDisabled: boolean;
  /** Status, Group and Technician change from the row while it is live and unlocked. */
  editable: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: (from: HTMLButtonElement) => void;
  onBusy: (busy: boolean) => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const subject = item.subject || 'No subject';
  const conversation = conversationState(item);
  const flags = [
    item.priority ? `${item.priority} priority` : '',
    item.vip ? 'VIP requester' : '',
    conversation?.label,
    hasNotes ? 'has notes' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const name = `Open ticket ${item.number}: ${subject}`;
  return (
    <li
      className={['sdp-queue-row', selected ? 'sdp-selected-row' : '', tint ? 'sdp-tinted-row' : '']
        .filter(Boolean)
        .join(' ')}
      style={tint}
    >
      <label className="sdp-select-ticket">
        <input
          type="checkbox"
          aria-label={`Select ticket ${item.number}`}
          checked={checked}
          disabled={selectDisabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </label>
      {/* The whole row opens the ticket; the status, group and technician pickers sit above it. */}
      <button
        className="ticket-row-open"
        aria-label={`${name}. ${flags}`}
        aria-current={selected || undefined}
        disabled={openDisabled}
        onClick={(event) => onOpen(event.currentTarget)}
      />
      <div className="sdp-queue-row__topline">
        <SdpRowFlags
          // The requester carries the VIP crown; without a requester name it joins the icons.
          vip={item.requesterName ? undefined : item.vip}
          priority={item.priority}
          conversation={conversation}
          hasNotes={hasNotes}
        />
        <SdpRowQuickEdit
          ticket={item}
          field="status"
          editable={editable}
          onBusy={onBusy}
          onResult={onResult}
        />
        <span className="sdp-queue-row__time">
          <CreatedTime createdAt={item.createdAt} />
        </span>
      </div>
      <div className="sdp-queue-row__title" aria-hidden="true">
        <strong title={subject}>{subject}</strong>
        {item.replyUnread && <span className="sdp-unread-reply sdp-row-unread">Unread</span>}
      </div>
      {/* Middots separate the number, requester, group and technician, as one context line. */}
      <div className="sdp-queue-row__context">
        <span className="sdp-queue-row__item ticket-id" aria-hidden="true">
          #{item.number}
        </span>
        {item.requesterName && (
          <span className="sdp-queue-row__item sdp-row-requester">
            {item.vip && <SdpVipFlag />}
            <span className="sdp-row-requester-name" title={item.requesterName}>
              {item.requesterName}
            </span>
          </span>
        )}
        {(['group', 'technician'] as const).map((field) => (
          <span key={field} className="sdp-queue-row__item">
            <SdpRowQuickEdit
              ticket={item}
              field={field}
              editable={editable}
              onBusy={onBusy}
              onResult={onResult}
            />
          </span>
        ))}
      </div>
    </li>
  );
}

const loadingCaption = (queue: SdpQueue, previewing: boolean) =>
  `${previewing ? 'Updating' : 'Loading'} ${queue} queue…`;
/** The heading's count, with VIP requesters and unread replies on this page when there are any. */
function queueCaption(result: SdpAccountView['queuePage']): string {
  if (!result) return 'Queue not loaded';
  const { tickets } = result;
  const vip = tickets.filter((item) => item.vip).length;
  const unread = tickets.filter((item) => item.replyUnread).length;
  return [
    `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`,
    vip ? `${vip} VIP` : '',
    unread ? `${unread} unread` : '',
    result.filters ? 'Filtered by SDP' : '',
    result.hasMore ? 'More in SDP' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function queueEmptyMessage(result: SdpAccountView['queuePage'], canLoad: boolean) {
  if (!result) return canLoad ? 'Choose a queue or Refresh Queue to load tickets.' : undefined;
  if (result.tickets.length > 0) return undefined;
  return result.filters
    ? 'No tickets in this queue match these filters.'
    : 'No tickets returned for this queue.';
}

type LoadedRows = { key: string; tickets: SdpQueueTicket[]; notes: string[] };
type QueueNotes = ReturnType<typeof useSdpQueueNotes>;
const noteIds = (notes: QueueNotes) => [...(notes?.ids ?? [])];

/** The newest page with any earlier pages' rows (and their note marks) above it. */
function withLoadedRows(
  kept: LoadedRows | undefined,
  pageNumber: number,
  key: string,
  page: SdpAccountView['queuePage'],
  notes: QueueNotes,
): { result: SdpAccountView['queuePage']; notes: QueueNotes } {
  if (!pageNumber || kept?.key !== key || !page) return { result: page, notes };
  return {
    result: withEarlierRows(kept, page),
    notes: notes && { ...notes, ids: new Set([...kept.notes, ...notes.ids]) },
  };
}

/**
 * Earlier pages' rows above the newest page. A ticket the newest page also lists shows its newer
 * copy once, in its earlier place, so a row that shifted pages is not listed twice.
 */
function withEarlierRows(
  kept: LoadedRows,
  page: NonNullable<SdpAccountView['queuePage']>,
): NonNullable<SdpAccountView['queuePage']> {
  const fresh = new Map(page.tickets.map((item) => [item.id, item]));
  const rows = kept.tickets.map((item) => fresh.get(item.id) ?? item);
  const listed = new Set(rows.map((item) => item.id));
  return { ...page, tickets: [...rows, ...page.tickets.filter((item) => !listed.has(item.id))] };
}
