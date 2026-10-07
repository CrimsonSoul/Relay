import { useId, type KeyboardEvent, type ReactNode } from 'react';
import type { SdpDetail } from '@shared/sdpAccount';
import { SdpBody } from './SdpBody';
import { SdpConversationThread, type SdpThreadActions } from './SdpConversationThread';
const sections = ['Conversations', 'Work', 'Attachments', 'Links & bridge', 'Details'] as const;
export type SdpDetailSection =
  (typeof sections)[number] | 'Description' | 'Messages' | 'Resolution' | 'History';

/** The top-level tab that hosts a section; sub-views live under Details or Conversations. */
function topLevelSection(section: SdpDetailSection): (typeof sections)[number] {
  if (section === 'Resolution' || section === 'History') return 'Details';
  if (section === 'Description' || section === 'Messages') return 'Conversations';
  return section;
}
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
  actions,
  draft,
  draftAt,
  busy,
  onPage,
  section,
  setSection,
  history,
  work,
  attachments,
  relationships,
}: Readonly<{
  /** Per-message Reply, Reply All and Forward; absent while they are unavailable. */
  actions?: SdpThreadActions;
  /** An open reply or forward draft, shown beneath the message it answers. */
  draft?: ReactNode;
  draftAt?: string;
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
  const activeSection = topLevelSection(section);
  const thread = section === 'Conversations' || section === 'Messages';
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
        aria-labelledby={`${sectionsId}-tab-${sections.indexOf(activeSection)}`}
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
        {section === 'Description' && (
          <section className="sdp-original-request" aria-label="Description">
            <h4 className="sdp-thread-label">Original request</h4>
            <SdpBody html={detail.description} ticketId={detail.id} />
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
            <SdpBody html={detail.resolution ?? ''} ticketId={detail.id} />
          </section>
        )}
        {thread && (
          <SdpConversationThread
            detail={detail}
            showRequest={section === 'Conversations'}
            busy={busy}
            actions={actions}
            onPage={onPage}
            draft={draft}
            draftAt={draftAt}
          />
        )}
        {!thread && draft}
      </div>
    </>
  );
}
