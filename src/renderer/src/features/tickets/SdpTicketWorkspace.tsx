import { SdpHistoryPanel } from './SdpHistoryPanel';
import { useEffect, useRef, useState } from 'react';
import type { BridgeGroup } from '@shared/ipc';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { ContextMenu } from '../../components/ContextMenu';
import { TactileButton } from '../../components/TactileButton';
import { SdpIcon } from './SdpIcon';
import { SdpAttachmentsPanel } from './SdpAttachmentsPanel';
import { SdpNativeEditor } from './SdpNativeEditor';
import { SdpRelationships, SdpBridgeDialog } from './SdpRelationships';
import { SdpReplyStatus } from './SdpReplyStatus';
import { SdpResourcesPanel } from './SdpResourcesPanel';
import { SdpTicketContent, type SdpDetailSection } from './SdpTicketContent';
import { SdpTicketRelationsPanel } from './SdpTicketRelationsPanel';

type Props = Readonly<{
  ticket: SdpQueueTicket;
  view?: SdpAccountView;
  groups: BridgeGroup[];
  busy: boolean;
  editor?: 'edit' | 'reply' | 'forward';
  section: SdpDetailSection;
  onSection: (section: SdpDetailSection) => void;
  onEditor: (editor?: 'edit' | 'reply' | 'forward') => void;
  onAction: (mode: 'note' | 'resolve') => void;
  onResult: (view: SdpAccountView) => void;
  onRefresh: (page: number, includeAutoNotifications?: boolean) => void;
  onClose: () => void;
}>;

export function SdpTicketWorkspace({
  ticket,
  view,
  groups,
  busy,
  editor,
  section,
  onSection,
  onEditor,
  onAction,
  onResult,
  onRefresh,
  onClose,
}: Props) {
  const [forwardSource, setForwardSource] = useState<string>();
  const [bridge, setBridge] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const draft = useRef<HTMLDivElement>(null);
  const moreActions = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editor) return;
    draft.current?.focus({ preventScroll: true });
    draft.current?.scrollIntoView?.({ block: 'nearest' });
  }, [editor]);
  const live = view?.detailSnapshot?.source === 'live';
  const detail = view?.detail?.id === ticket.id ? view.detail : undefined;
  return (
    <aside className="sdp-ticket-pane" aria-label={`Ticket ${ticket.number}`}>
      <section className="sdp-live-detail">
        <header className="sdp-ticket-heading">
          <div className="sdp-ticket-toolbar">
            <div className="sdp-ticket-identity">
              <span className="ticket-id">#{ticket.number}</span>
              <span className="ticket-badge">{ticket.status}</span>
            </div>
            <TactileButton size="sm" variant="ghost" disabled={!!editor} onClick={onClose}>
              Back to queue
            </TactileButton>
          </div>
          <h3>{ticket.subject || 'No subject'}</h3>
          <div className="sdp-ticket-heading-footer">
            <SdpReplyStatus ticket={ticket} />
            {!editor && (
              <div className="ticket-actions">
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={busy || !live}
                  onClick={() => onAction('note')}
                >
                  Add note
                </TactileButton>
                <TactileButton size="sm" disabled={busy || !live} onClick={() => onEditor('edit')}>
                  Edit ticket
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="ghost"
                  ref={moreActions}
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  disabled={busy}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  <span className="sdp-menu-label">
                    More actions <SdpIcon name="chevron" />
                  </span>
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="primary"
                  disabled={busy || !live}
                  onClick={() => {
                    onSection('Conversations');
                    onEditor('reply');
                  }}
                >
                  Reply
                </TactileButton>
              </div>
            )}
          </div>
          {ticket.replyUnread && (
            <output className="sdp-reply-update">
              <span>A reply has not been read in Relay.</span>
              <TactileButton
                size="sm"
                disabled={busy || !!editor || view?.snapshot?.source !== 'live'}
                onClick={() => onRefresh(0)}
              >
                Load latest reply
              </TactileButton>
              {editor && <span>Finish or cancel your draft to load the reply.</span>}
            </output>
          )}
        </header>
        {menu && !editor && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(undefined)}
            items={[
              {
                label: 'Forward ticket',
                disabled: busy || !live,
                onClick: () => {
                  setForwardSource(undefined);
                  onEditor('forward');
                },
              },
              {
                label: 'Prepare incident bridge',
                disabled: busy || !live,
                onClick: () => {
                  moreActions.current?.focus();
                  setBridge(true);
                },
              },
              {
                label: 'Resolve ticket',
                disabled: busy || !live,
                onClick: () => onAction('resolve'),
              },
              {
                label: 'Refresh ticket',
                disabled: busy,
                onClick: () => onRefresh(detail?.page ?? 0),
              },
              {
                label: 'Open in SDP',
                onClick: () =>
                  void globalThis.api?.openExternal(
                    `https://support.campingworld.com/app/itdesk/ui/requests/${ticket.id}/details`,
                  ),
              },
            ]}
          />
        )}
        <div className={`sdp-ticket-layout ${editor === 'edit' ? 'is-editing' : ''}`}>
          <div className="sdp-ticket-thread">
            {editor !== 'edit' && (
              <>
                {busy && (
                  <p>
                    <output>Loading ticket description and conversations…</output>
                  </p>
                )}
                {detail && (
                  <SdpTicketContent
                    onForward={
                      !busy && !editor && live
                        ? (id) => {
                            setForwardSource(id);
                            onEditor('forward');
                          }
                        : undefined
                    }
                    section={section}
                    setSection={onSection}
                    detail={detail}
                    history={
                      <SdpHistoryPanel
                        key={ticket.id}
                        id={ticket.id}
                        enabled={!busy && !editor && live}
                      />
                    }
                    relationships={
                      <>
                        <SdpRelationships ticket={ticket} />
                        <SdpTicketRelationsPanel
                          key={ticket.id}
                          ticket={ticket}
                          enabled={!busy && !editor && live}
                          onResult={onResult}
                        />
                      </>
                    }
                    attachments={
                      <SdpAttachmentsPanel
                        id={ticket.id}
                        number={ticket.number}
                        files={detail.attachments ?? []}
                        enabled={!busy && !editor && live}
                        onResult={onResult}
                      />
                    }
                    work={
                      <SdpResourcesPanel
                        id={ticket.id}
                        enabled={!busy && !editor && view?.snapshot?.source === 'live'}
                        onResult={onResult}
                      />
                    }
                    busy={busy || !!editor}
                    onPage={onRefresh}
                  />
                )}
                {!busy && !detail && (
                  <p>
                    <output>
                      {view?.message ??
                        'Ticket content is unavailable. Refresh the ticket to try again.'}
                    </output>
                  </p>
                )}
              </>
            )}
            {editor && (
              <div className="sdp-inline-editor" ref={draft} tabIndex={-1}>
                <SdpNativeEditor
                  key={`${ticket.id}-${editor}`}
                  ticket={ticket}
                  mode={editor}
                  sourceId={editor === 'forward' ? forwardSource : undefined}
                  onClose={() => onEditor(undefined)}
                  onResult={onResult}
                />
              </div>
            )}
          </div>
          <section className="sdp-ticket-inspector" aria-label="Ticket overview">
            <h4 className="toolbar-title">Ticket overview</h4>
            <dl className="ticket-metadata sdp-live-summary">
              {[
                ['Status', ticket.status],
                ['Priority', ticket.priority],
                ['Support group', ticket.group],
                ['Technician', ticket.technician || 'Unassigned'],
                [
                  'Due',
                  ticket.dueAt === null ? 'Not set' : new Date(ticket.dueAt).toLocaleString(),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {detail && (
              <p className="sdp-ticket-source">
                <span className={live ? 'tab-page-status' : undefined}>
                  {live ? 'Live from SDP' : 'Saved copy · Read only'}
                </span>
                {view?.detailSnapshot && (
                  <time dateTime={new Date(view.detailSnapshot.fetchedAt).toISOString()}>
                    Updated{' '}
                    {new Date(view.detailSnapshot.fetchedAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                )}
              </p>
            )}
          </section>
        </div>
      </section>
      {bridge && (
        <SdpBridgeDialog ticket={ticket} groups={groups} onClose={() => setBridge(false)} />
      )}
    </aside>
  );
}
