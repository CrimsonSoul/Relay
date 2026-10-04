import {
  createElement,
  Fragment,
  useId,
  useMemo,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
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
const detailViews = ['Details', 'Resolution', 'History'] as const;
const detailViewLabels: Partial<Record<SdpDetailSection, string>> = { Details: 'Properties' };

function SectionTabs({
  label,
  className,
  items,
  active,
  idPrefix,
  panelId,
  labels,
  onSelect,
}: Readonly<{
  label: string;
  className: string;
  items: readonly SdpDetailSection[];
  active: SdpDetailSection;
  idPrefix: string;
  panelId: string;
  labels: Partial<Record<SdpDetailSection, string>>;
  onSelect: (section: SdpDetailSection) => void;
}>) {
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    onSelect(items[next]!);
    const target = event.currentTarget.parentElement?.children[next];
    if (target instanceof HTMLElement) target.focus();
  }
  return (
    <div className={`ticket-queues tab-strip ${className}`} role="tablist" aria-label={label}>
      {items.map((name, index) => (
        <button
          key={name}
          id={`${idPrefix}-tab-${index}`}
          type="button"
          className="tab-strip__tab"
          role="tab"
          aria-selected={active === name}
          aria-controls={panelId}
          tabIndex={active === name ? 0 : -1}
          onClick={() => onSelect(name)}
          onKeyDown={(event) => keyDown(event, index)}
        >
          {labels[name] ?? name}
        </button>
      ))}
    </div>
  );
}
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
  const sectionsId = useId();
  const viewsId = useId();
  const detailsGroup = (detailViews as readonly SdpDetailSection[]).includes(section);
  return (
    <>
      <SectionTabs
        label="Ticket sections"
        className="sdp-detail-sections"
        items={sections}
        active={activeSection}
        idPrefix={sectionsId}
        panelId={`${sectionsId}-panel`}
        labels={sectionLabels}
        onSelect={setSection}
      />
      <div
        className="sdp-section-panel"
        role="tabpanel"
        id={`${sectionsId}-panel`}
        aria-labelledby={`${sectionsId}-tab-${sections.findIndex((name) => name === activeSection)}`}
      >
        {detailsGroup && (
          <SectionTabs
            label="Ticket details views"
            className="sdp-detail-subsections"
            items={detailViews}
            active={section}
            idPrefix={viewsId}
            panelId={`${sectionsId}-panel`}
            labels={detailViewLabels}
            onSelect={setSection}
          />
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
              <div className="panel-error ink-rail ink-rail--alarm" role="alert">
                <span>{detail.conversationError}</span>
                <TactileButton size="sm" disabled={busy} onClick={() => onPage(detail.page)}>
                  Try Again
                </TactileButton>
              </div>
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
                        Forward Message
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
              <div className="panel-error ink-rail ink-rail--alarm" role="alert">
                <span>{detail.notesError}</span>
                <TactileButton size="sm" disabled={busy} onClick={() => onPage(detail.page)}>
                  Try Again
                </TactileButton>
              </div>
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
                        <span className="sdp-message-kind">Internal note</span>
                      </span>
                      <time>{date(entry.createdAt)}</time>
                    </header>
                    <SdpBody html={entry.body} />
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
              Newer Activity
            </TactileButton>
            <span className="ticket-mode-note">Page {detail.page + 1}</span>
            <TactileButton
              size="sm"
              disabled={busy || !hasMore || detail.page >= 19}
              onClick={() => onPage(detail.page + 1)}
            >
              Older Activity
            </TactileButton>
          </div>
        )}
      </div>
    </>
  );
}
