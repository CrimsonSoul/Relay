import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { SdpDetail } from '@shared/sdpAccount';
import { TactileButton } from '../../components/TactileButton';
import { formatMessageTime } from '../../utils/opsTime';
import { SdpBody } from './SdpBody';

type Entry = {
  kind: 'email' | 'note';
  id: string;
  author: string;
  createdAt: number | null;
  subject?: string;
  body: string;
};
export type SdpThreadActions = {
  onReply: (id: string, all: boolean) => void;
  onForward: (id: string) => void;
};

const when = (value: number | null): string =>
  value === null ? 'Time not set' : formatMessageTime(value);
const initial = (author: string) => author.trim().slice(0, 1).toUpperCase() || '—';

/** The requester property, when SDP returned it, names who wrote the original request. */
export const requesterOf = (detail: SdpDetail): string =>
  detail.properties?.find((field) => field.label === 'Requester')?.value || 'Requester';

function entries(detail: SdpDetail, emails: boolean, notes: boolean, newestFirst: boolean) {
  const list: Entry[] = [
    ...(emails ? detail.conversations.map((item) => ({ ...item, kind: 'email' as const })) : []),
    ...(notes ? (detail.notes ?? []).map((item) => ({ ...item, kind: 'note' as const })) : []),
  ];
  const time = (entry: Entry) => entry.createdAt ?? 0;
  return list.sort((a, b) => (newestFirst ? time(b) - time(a) : time(a) - time(b)));
}

function MessageActions({
  id,
  name,
  actions,
}: Readonly<{ id: string; name: string; actions?: SdpThreadActions }>) {
  if (!actions) return null;
  return (
    <div className="sdp-thread-actions">
      <TactileButton
        size="xs"
        variant="ghost"
        aria-label={`Reply to ${name}`}
        onClick={() => actions.onReply(id, false)}
      >
        Reply
      </TactileButton>
      <TactileButton
        size="xs"
        variant="ghost"
        aria-label={`Reply all to ${name}`}
        onClick={() => actions.onReply(id, true)}
      >
        Reply All
      </TactileButton>
      <TactileButton
        size="xs"
        variant="ghost"
        aria-label={`Forward ${name}`}
        onClick={() => actions.onForward(id)}
      >
        Forward
      </TactileButton>
    </div>
  );
}

function ThreadEntry({
  entry,
  ticketId,
  actions,
}: Readonly<{ entry: Entry; ticketId: string; actions?: SdpThreadActions }>) {
  const note = entry.kind === 'note';
  return (
    <article
      className={`sdp-thread-card ${note ? 'is-note' : ''}`}
      aria-label={`${note ? 'Note' : 'Email'} from ${entry.author}, ${when(entry.createdAt)}`}
    >
      <span className="sdp-author-mark sdp-thread-mark" aria-hidden="true">
        {initial(entry.author)}
      </span>
      <header>
        <span className="sdp-message-author">
          <strong>{entry.author}</strong>
          {note && <span className="sdp-message-kind">Internal note</span>}
        </span>
        <time>{when(entry.createdAt)}</time>
      </header>
      {entry.subject && <h4>{entry.subject}</h4>}
      <SdpBody html={entry.body} ticketId={ticketId} quotes />
      {!note && (
        <MessageActions
          id={entry.id}
          name={`email from ${entry.author}, ${when(entry.createdAt)}`}
          actions={actions}
        />
      )}
    </article>
  );
}

/**
 * The ticket as one thread: internal notes at the top, as SDP shows them, then the original request
 * and emails in time order. A reply or forward draft opens directly beneath the message it answers.
 */
export function SdpConversationThread({
  detail,
  showRequest,
  busy,
  actions,
  onPage,
  draft,
  draftAt,
}: Readonly<{
  detail: SdpDetail;
  showRequest: boolean;
  busy: boolean;
  actions?: SdpThreadActions;
  onPage: (page: number, includeAutoNotifications?: boolean) => void;
  draft?: ReactNode;
  /** `request`, an email ID, or nothing for the end of the thread. */
  draftAt?: string;
}>) {
  const [emails, setEmails] = useState(true);
  const [notes, setNotes] = useState(true);
  const [newestFirst, setNewestFirst] = useState(false);
  const [openFor, setOpenFor] = useState<string>();
  const list = useMemo(
    () => entries(detail, emails, notes, newestFirst),
    [detail, emails, notes, newestFirst],
  );
  const requester = requesterOf(detail);
  const requestOpen = openFor === detail.id || !list.length || draftAt === 'request';
  const anchored = (id: string) => draftAt === id && !!draft;
  const placed =
    (showRequest && draftAt === 'request') ||
    list.some((entry) => entry.kind === 'email' && entry.id === draftAt);
  const olderExists = detail.hasMore || (notes && !!detail.notesHasMore);
  const request = showRequest && (
    <li className="sdp-thread-item is-request">
      <details
        className="sdp-thread-description"
        open={requestOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open !== requestOpen) setOpenFor(open ? detail.id : '');
        }}
      >
        <summary>Description</summary>
        <article className="sdp-thread-card" aria-label={`Original request from ${requester}`}>
          <span className="sdp-author-mark sdp-thread-mark" aria-hidden="true">
            {initial(requester)}
          </span>
          <header>
            <span className="sdp-message-author">
              <strong>{requester}</strong>
              <span className="sdp-message-kind">Original request</span>
            </span>
          </header>
          <SdpBody html={detail.description} ticketId={detail.id} quotes />
          <MessageActions id="request" name="original request" actions={actions} />
        </article>
      </details>
      {anchored('request') && draft}
    </li>
  );
  const older = olderExists && (
    <li className="sdp-thread-gap">
      <TactileButton
        size="sm"
        variant="ghost"
        disabled={busy || detail.page >= 19}
        onClick={() => onPage(detail.page + 1)}
      >
        Show Earlier Messages
      </TactileButton>
    </li>
  );
  const newer = detail.page > 0 && (
    <li className="sdp-thread-gap">
      <TactileButton
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onPage(detail.page - 1)}
      >
        Show Newer Messages
      </TactileButton>
    </li>
  );
  const item = (entry: Entry) => (
    <li className={`sdp-thread-item is-${entry.kind}`} key={`${entry.kind}-${entry.id}`}>
      <ThreadEntry entry={entry} ticketId={detail.id} actions={actions} />
      {entry.kind === 'email' && anchored(entry.id) && draft}
    </li>
  );
  const noteItems = list.filter((entry) => entry.kind === 'note').map(item);
  const items = list.filter((entry) => entry.kind === 'email').map(item);
  return (
    <section aria-label="Conversation history">
      <div className="sdp-conversation-controls">
        <h4 className="sdp-thread-label">Conversation</h4>
        <fieldset className="sdp-thread-filters">
          <legend>Filter</legend>
          <label>
            <input
              type="checkbox"
              checked={emails}
              onChange={(event) => setEmails(event.target.checked)}
            />
            <span>Emails</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={detail.includeAutoNotifications ?? false}
              disabled={busy || !emails}
              onChange={(event) => onPage(0, event.target.checked)}
            />
            <span>Automatic notifications</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={notes}
              onChange={(event) => setNotes(event.target.checked)}
            />
            <span>Notes</span>
          </label>
        </fieldset>
        <TactileButton
          size="xs"
          variant="ghost"
          aria-label={`Sort order: ${newestFirst ? 'newest' : 'oldest'} first`}
          onClick={() => setNewestFirst((value) => !value)}
        >
          {newestFirst ? 'Newest First' : 'Oldest First'}
        </TactileButton>
      </div>
      {detail.conversationError && (
        <div className="panel-error ink-rail ink-rail--alarm" role="alert">
          <span>{detail.conversationError}</span>
          <TactileButton size="sm" disabled={busy} onClick={() => onPage(detail.page)}>
            Try Again
          </TactileButton>
        </div>
      )}
      {notes && detail.notesError && (
        <div className="panel-error ink-rail ink-rail--alarm" role="alert">
          <span>{detail.notesError}</span>
          <TactileButton size="sm" disabled={busy} onClick={() => onPage(detail.page)}>
            Try Again
          </TactileButton>
        </div>
      )}
      <ol className="sdp-thread">
        {noteItems}
        {newestFirst ? (
          <>
            {newer}
            {items}
            {older}
            {request}
          </>
        ) : (
          <>
            {request}
            {older}
            {items}
            {newer}
          </>
        )}
        {!list.length && !showRequest && (
          <li className="sdp-thread-gap">
            <p>No messages on this page.</p>
          </li>
        )}
      </ol>
      {!placed && draft && <Fragment>{draft}</Fragment>}
    </section>
  );
}
