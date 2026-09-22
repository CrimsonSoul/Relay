import { createElement, Fragment, useMemo, type ReactElement, type ReactNode } from 'react';
import type { SdpDetail } from '@shared/sdpAccount';
import { TactileButton } from '../../components/TactileButton';
const date = (value: number | null): string =>
  value === null ? 'Not set' : new Date(value).toLocaleString();
export function SdpBody({ html }: Readonly<{ html: string }>) {
  const content = useMemo(() => {
    // Parse inertly, then reconstruct an explicit formatting allowlist with no source attributes.
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content
      .querySelectorAll(
        'script,style,iframe,object,embed,svg,math,link,meta,form,input,button,select,textarea',
      )
      .forEach((node) => node.remove());
    const allowed = new Set([
      'p',
      'div',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'pre',
      'code',
    ]);
    const render = (node: Node, key: string, depth = 0): ReactElement => {
      if (node.nodeType === Node.TEXT_NODE)
        return <Fragment key={key}>{node.textContent}</Fragment>;
      if (!(node instanceof Element)) return <Fragment key={key} />;
      if (node.tagName === 'IMG') return <span key={key}>[Image omitted]</span>;
      if (depth > 80) return <Fragment key={key}>{node.textContent}</Fragment>;
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map((child, index) =>
        render(child, `${key}-${index}`, depth + 1),
      );
      if (tag === 'br') return <br key={key} />;
      if (allowed.has(tag)) return createElement(tag, { key }, children);
      return <Fragment key={key}>{children}</Fragment>;
    };
    return Array.from(template.content.childNodes).map((node, index) =>
      render(node, String(index)),
    );
  }, [html]);
  return <div className="sdp-live-body">{html.trim() ? content : 'No content.'}</div>;
}
const sections = [
  'Conversations',
  'Notes',
  'Work',
  'Attachments',
  'Links & bridge',
  'Details',
] as const;
export type SdpDetailSection =
  (typeof sections)[number] | 'Description' | 'Messages' | 'Resolution' | 'History';
const sectionLabels: Partial<Record<SdpDetailSection, string>> = {
  Conversations: 'Conversation',
  'Links & bridge': 'Related',
};
export function SdpTicketContent({
  detail,
  onForward,
  busy,
  onPage,
  section,
  setSection,
  history,
  work,
  attachments,
  relationships,
}: Readonly<{
  onForward?: (id: string) => void;
  history?: ReactNode;
  work?: ReactNode;
  attachments?: ReactNode;
  relationships?: ReactNode;
  detail: SdpDetail;
  busy: boolean;
  onPage: (page: number, includeAutoNotifications?: boolean) => void;
  section: SdpDetailSection;
  setSection: (section: SdpDetailSection) => void;
}>) {
  let activeSection = section;
  if (['Resolution', 'History'].includes(section)) activeSection = 'Details';
  if (['Description', 'Messages'].includes(section)) activeSection = 'Conversations';
  const paginated = section === 'Conversations' || section === 'Messages' || section === 'Notes';
  const hasMore = section === 'Notes' ? detail.notesHasMore : detail.hasMore;
  return (
    <>
      <nav className="ticket-queues sdp-detail-sections" aria-label="Ticket sections">
        {sections.map((name) => (
          <button
            key={name}
            disabled={busy}
            aria-current={activeSection === name ? 'page' : undefined}
            onClick={() => setSection(name)}
          >
            {sectionLabels[name] ?? name}
          </button>
        ))}
      </nav>
      {['Details', 'Resolution', 'History'].includes(section) && (
        <nav className="ticket-queues sdp-detail-subsections" aria-label="Ticket details views">
          {(['Details', 'Resolution', 'History'] as const).map((name) => (
            <button
              key={name}
              disabled={busy}
              aria-current={section === name ? 'page' : undefined}
              onClick={() => setSection(name)}
            >
              {name === 'Details' ? 'Properties' : name}
            </button>
          ))}
        </nav>
      )}
      {section === 'History' && history}
      {section === 'Work' && work}
      {section === 'Attachments' && attachments}
      {section === 'Links & bridge' && relationships}
      {section === 'Conversations' && (
        <details className="sdp-original-request sdp-collapsed-request">
          <summary>Original request</summary>
          <SdpBody html={detail.description} />
        </details>
      )}
      {section === 'Description' && (
        <section className="sdp-original-request" aria-label="Description">
          <h4 className="sdp-thread-label">Original request</h4>
          <SdpBody html={detail.description} />
        </section>
      )}
      {section === 'Details' && (
        <section aria-label="Ticket properties">
          <dl className="ticket-metadata sdp-live-properties">
            {detail.properties?.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          {!detail.properties && <p>Refresh the ticket to load its properties.</p>}
        </section>
      )}
      {section === 'Resolution' && (
        <section aria-label="Resolution">
          <SdpBody html={detail.resolution ?? ''} />
        </section>
      )}
      {(section === 'Messages' || section === 'Conversations') && (
        <section aria-label="Conversation history">
          <div className="sdp-conversation-controls">
            <h4 className="sdp-thread-label">Recent messages</h4>
            <label>
              <input
                type="checkbox"
                checked={detail.includeAutoNotifications ?? false}
                disabled={busy}
                onChange={(event) => onPage(0, event.target.checked)}
              />
              <span>Show automatic notifications</span>
            </label>
          </div>
          {detail.conversationError ? (
            <p role="alert">{detail.conversationError}</p>
          ) : (
            <>
              {detail.conversations.length === 0 && <p>No messages on this page.</p>}
              {detail.conversations.map((entry) => (
                <article className="sdp-live-conversation" key={entry.id}>
                  <header>
                    <span className="sdp-message-author">
                      <span className="sdp-author-mark" aria-hidden="true">
                        {entry.author.trim().slice(0, 1).toUpperCase() || '—'}
                      </span>
                      <strong>{entry.author}</strong>
                    </span>
                    <time>{date(entry.createdAt)}</time>
                  </header>
                  {entry.subject && <h4>{entry.subject}</h4>}
                  <SdpBody html={entry.body} />
                  {onForward && (
                    <TactileButton size="sm" variant="ghost" onClick={() => onForward(entry.id)}>
                      Forward message
                    </TactileButton>
                  )}
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {section === 'Notes' && (
        <section aria-label="SDP notes">
          {detail.notesError ? (
            <p role="alert">{detail.notesError}</p>
          ) : (
            <>
              {!detail.notes ? (
                <p>Refresh the ticket to load notes.</p>
              ) : (
                detail.notes.length === 0 && <p>No notes on this page.</p>
              )}
              {detail.notes?.map((entry) => (
                <article className="sdp-live-conversation" key={entry.id}>
                  <header>
                    <span className="sdp-message-author">
                      <span className="sdp-author-mark" aria-hidden="true">
                        {entry.author.trim().slice(0, 1).toUpperCase() || '—'}
                      </span>
                      <strong>{entry.author}</strong>
                    </span>
                    <time>{date(entry.createdAt)}</time>
                  </header>
                  <SdpBody html={entry.body} />
                  {onForward && (
                    <TactileButton size="sm" variant="ghost" onClick={() => onForward(entry.id)}>
                      Forward message
                    </TactileButton>
                  )}
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {paginated && (detail.page > 0 || hasMore) && (
        <div className="ticket-actions">
          <TactileButton
            size="sm"
            disabled={busy || detail.page === 0}
            onClick={() => onPage(detail.page - 1)}
          >
            Previous activity
          </TactileButton>
          <span className="ticket-mode-note">Page {detail.page + 1}</span>
          <TactileButton
            size="sm"
            disabled={busy || !hasMore || detail.page >= 19}
            onClick={() => onPage(detail.page + 1)}
          >
            Next activity
          </TactileButton>
        </div>
      )}
    </>
  );
}
