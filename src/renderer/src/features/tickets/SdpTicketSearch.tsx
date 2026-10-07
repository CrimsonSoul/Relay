import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  SDP_SERVER_UPDATE_MESSAGE,
  type SdpAccountCommand,
  type SdpAccountView,
  type SdpTicketSearch,
} from '@shared/sdpAccount';
import type { IpcResult } from '@shared/ipc';
import { TactileButton } from '../../components/TactileButton';
import { CreatedTime, technicianLabel, VipBadge } from './sdpQueueFormat';

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];
/** One SDP-wide search: the request sent, then its results or the reason it failed. */
export type SdpSearchState = Readonly<{
  query: string;
  page: number;
  loading: boolean;
  result?: SdpTicketSearch;
  error?: string;
}>;

const SEARCH_FAILED = 'Could not search SDP. Check your work sign-in, then try again.';
/** SDP-wide search beside queue reads; only the newest search is shown. */
export function useSdpTicketSearch(
  invoke: ((command: SdpAccountCommand) => Promise<IpcResult<SdpAccountView>>) | undefined,
) {
  const [search, setSearch] = useState<SdpSearchState>();
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function searchSdp(query: string, page: number) {
    if (!invoke) return;
    const current = ++sequence.current;
    setSearch((old) => ({
      query,
      page,
      loading: true,
      result: old?.query === query ? old.result : undefined,
    }));
    let next: SdpSearchState = { query, page, loading: false, error: SEARCH_FAILED };
    try {
      const reply = await invoke({ action: 'searchTickets', query, page });
      const found = reply.success ? reply.data?.ticketSearch : undefined;
      if (found) next = { query, page, loading: false, result: found };
      else if (!reply.success && reply.error === SDP_SERVER_UPDATE_MESSAGE)
        next = { ...next, error: 'The Relay server needs an update to search all of SDP.' };
    } catch {
      // The failure state set above stands.
    }
    if (current === sequence.current) setSearch(next);
  }
  function closeSearch() {
    sequence.current++;
    setSearch(undefined);
  }
  return { search, searchSdp, closeSearch };
}

/**
 * Searches every SDP request the person can see. It sits after the queue tabs and is marked
 * current, like a tab, while its results replace the queue.
 */
export function SdpSearchForm({
  initial = '',
  current,
  disabled,
  onSearch,
}: Readonly<{
  initial?: string;
  current: boolean;
  disabled: boolean;
  onSearch: (query: string) => void;
}>) {
  const [text, setText] = useState(initial);
  const [shown, setShown] = useState(initial);
  // A search started elsewhere (⌘K) shows its text here.
  if (initial !== shown) {
    setShown(initial);
    setText(initial);
  }
  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const query = text.trim();
    if (query) onSearch(query);
  }
  return (
    <form
      className={`sdp-global-search ${current ? 'is-current' : ''}`}
      role="search"
      onSubmit={submit}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        aria-label="Search all SDP tickets"
        placeholder="Search all of SDP…"
        maxLength={200}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      {/* Enter also searches; the button appears once there is something to search for. */}
      {text.trim() && !disabled && (
        <TactileButton size="xs" variant="ghost" type="submit">
          Search SDP
        </TactileButton>
      )}
    </form>
  );
}

export function SdpSearchResults({
  search,
  selected,
  locked,
  onOpen,
  onPage,
  onClose,
}: Readonly<{
  search: SdpSearchState;
  selected: string;
  locked: boolean;
  onOpen: (ticket: SdpTicketSearch['tickets'][number], from: HTMLButtonElement) => void;
  onPage: (page: number) => void;
  onClose: () => void;
}>) {
  const tickets = search.result?.tickets ?? [];
  let caption = `Searching all of SDP for “${search.query}”…`;
  if (!search.loading && search.result)
    caption = `Showing ${tickets.length} SDP ${tickets.length === 1 ? 'ticket that matches' : 'tickets that match'} “${search.query}”`;
  else if (!search.loading) caption = `Search for “${search.query}” did not finish`;
  return (
    <section className="ticket-list sdp-search-results" aria-label="SDP search results">
      <div className="ticket-list-caption">
        <output aria-live="polite">{caption}</output>
        <TactileButton size="sm" variant="ghost" onClick={onClose}>
          Back to Queue
        </TactileButton>
      </div>
      {search.error && (
        <p role="alert" className="field-error sdp-search-error">
          {search.error}
        </p>
      )}
      <table
        className={`sdp-live-table ${search.loading ? 'is-loading' : ''}`}
        aria-busy={search.loading || undefined}
      >
        <colgroup>
          <col className="sdp-search-subject-column" />
          <col className="sdp-search-group-column" />
          <col className="sdp-live-status-column" />
          <col className="sdp-live-technician-column" />
          <col className="sdp-live-created-column" />
        </colgroup>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Support group</th>
            <th>Status</th>
            <th>Technician</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id} className={ticket.id === selected ? 'sdp-selected-row' : undefined}>
              <td>
                <button
                  className="ticket-row-open"
                  aria-label={`Open ticket ${ticket.number}: ${ticket.subject || 'No subject'}${ticket.vip ? '. VIP requester' : ''}`}
                  disabled={locked}
                  onClick={(event) => onOpen(ticket, event.currentTarget)}
                >
                  <span className="ticket-id">#{ticket.number}</span>
                  {ticket.vip && <VipBadge />}
                  <strong title={ticket.subject || 'No subject'}>
                    {ticket.subject || 'No subject'}
                  </strong>
                </button>
              </td>
              <td>{ticket.group}</td>
              <td>{ticket.status}</td>
              <td>{technicianLabel(ticket.technician)}</td>
              <td>
                <CreatedTime createdAt={ticket.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!search.loading && search.result && !tickets.length && (
        <p className="ticket-list-caption">No SDP tickets match this search.</p>
      )}
      <div className="ticket-actions sdp-queue-pagination">
        <TactileButton
          size="sm"
          disabled={search.loading || search.page === 0}
          onClick={() => onPage(search.page - 1)}
        >
          Previous
        </TactileButton>
        <TactileButton
          size="sm"
          disabled={search.loading || !search.result?.hasMore || search.page >= 19}
          onClick={() => onPage(search.page + 1)}
        >
          Next
        </TactileButton>
        <span className="sdp-page-number">Page {search.page + 1}</span>
      </div>
    </section>
  );
}
