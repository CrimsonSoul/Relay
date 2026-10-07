import { SdpHistoryPanel } from './SdpHistoryPanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BridgeGroup } from '@shared/ipc';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { ContextMenu } from '../../components/ContextMenu';
import { TactileButton } from '../../components/TactileButton';
import { SdpMoreIcon } from './SdpIcon';
import { SdpAttachmentsPanel } from './SdpAttachmentsPanel';
import { SdpNativeEditor } from './SdpNativeEditor';
import { SdpRelationships, SdpBridgeDialog } from './SdpRelationships';
import { SdpReplyStatus } from './SdpReplyStatus';
import { SdpResourcesPanel } from './SdpResourcesPanel';
import { SdpTicketContent, type SdpDetailSection } from './SdpTicketContent';
import { requesterOf, type SdpThreadActions } from './SdpConversationThread';
import { replyQuote } from './sdpEmailThread';
import { SdpTicketRelationsPanel } from './SdpTicketRelationsPanel';
import { SdpTicketOverview } from './SdpTicketOverview';
import { SdpMessage } from './SdpMessage';
import { unassigned, useSdpPickUp } from './SdpPickUp';
import { formatOpsTime } from '../../utils/opsTime';
import { VipBadge } from './sdpQueueFormat';

/** Where a reply or forward draft opens and what it starts with. */
type DraftSetup = { at?: string; sourceId?: string; quote?: string; withCc: boolean };
const TICKET_DRAFT: DraftSetup = { withCc: true };

/**
 * Holds the draft's element while the thread moves it beneath another message or out of the
 * thread, so switching sections never remounts (and so never loses) the draft.
 */
function DraftSlot({ host }: Readonly<{ host: HTMLElement }>) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = slot.current;
    node?.appendChild(host);
    return () => {
      if (host.parentNode === node) node?.removeChild(host);
    };
  }, [host]);
  return <div ref={slot} className="sdp-draft-slot" />;
}

type Props = Readonly<{
  ticket: SdpQueueTicket;
  view?: SdpAccountView;
  groups: BridgeGroup[];
  busy: boolean;
  editor?: 'edit' | 'reply' | 'forward';
  section: SdpDetailSection;
  onSection: (section: SdpDetailSection) => void;
  onEditor: (editor?: 'edit' | 'reply' | 'forward') => void;
  onAction: (mode: 'note' | 'close') => void;
  onResult: (view: SdpAccountView) => void;
  /** Pick Up is saving; queue navigation waits for it. */
  onOverviewBusy: (busy: boolean) => void;
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
  onOverviewBusy,
  onRefresh,
  onClose,
}: Props) {
  const [setup, setSetup] = useState<DraftSetup>(TICKET_DRAFT);
  const [setupFor, setSetupFor] = useState(editor);
  // Every closed draft resets, so a draft opened by a shortcut starts as a ticket reply.
  if (setupFor !== editor) {
    setSetupFor(editor);
    if (!editor) setSetup(TICKET_DRAFT);
  }
  const [draftHost] = useState(() => {
    const host = document.createElement('div');
    host.className = 'sdp-inline-editor';
    host.tabIndex = -1;
    return host;
  });
  const [bridge, setBridge] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const draft = useRef<HTMLDivElement>(null);
  const moreActions = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const replyButton = useRef<HTMLButtonElement>(null);
  const openEditor = useRef(editor);
  const pickUp = useSdpPickUp(ticket, onResult);
  useEffect(() => onOverviewBusy(pickUp.saving), [pickUp.saving, onOverviewBusy]);
  useEffect(() => () => onOverviewBusy(false), [onOverviewBusy]);
  const locked = busy || pickUp.saving;
  // The header actions hide while a draft is open, so closing it would leave focus on the page;
  // it returns to the action that opens that draft.
  useEffect(() => {
    const closed = openEditor.current;
    openEditor.current = editor;
    if (editor || !closed) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const opener = { edit: editButton, reply: replyButton, forward: moreActions }[closed];
    opener.current?.focus({ preventScroll: true });
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    if (editor === 'edit') {
      draft.current?.focus({ preventScroll: true });
      draft.current?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    draftHost.focus({ preventScroll: true });
    // Bring the whole draft up within the thread only (scrolling into view would also move the
    // clipped workspace around it), again as its form loads in, until the person scrolls.
    const thread = draftHost.closest('.sdp-ticket-thread');
    if (!thread) return;
    const reveal = () => {
      // The section tabs stay pinned at the top of the thread.
      const tabs =
        thread.querySelector('.sdp-detail-sections')?.getBoundingClientRect().height ?? 0;
      const offset = draftHost.getBoundingClientRect().top - thread.getBoundingClientRect().top;
      thread.scrollTo?.({ top: thread.scrollTop + offset - tabs - 12 });
    };
    reveal();
    if (typeof ResizeObserver !== 'function') return;
    const growing = new ResizeObserver(reveal);
    growing.observe(draftHost);
    const stop = () => growing.disconnect();
    const timer = setTimeout(stop, 1500);
    thread.addEventListener('wheel', stop, { once: true });
    return () => {
      clearTimeout(timer);
      thread.removeEventListener('wheel', stop);
      stop();
    };
  }, [editor, draftHost]);
  const live = view?.detailSnapshot?.source === 'live';
  const detail = view?.detail?.id === ticket.id ? view.detail : undefined;
  const actions: SdpThreadActions | undefined =
    detail && live && !locked && !editor
      ? {
          onReply: (id, all) => {
            const message =
              id === 'request'
                ? {
                    author: requesterOf(detail),
                    createdAt: null,
                    subject: ticket.subject,
                    body: detail.description,
                  }
                : detail.conversations.find((entry) => entry.id === id);
            setSetup({ at: id, withCc: all, quote: message && replyQuote(message) });
            onEditor('reply');
          },
          onForward: (id) => {
            setSetup({ at: id, sourceId: id === 'request' ? undefined : id, withCc: false });
            onEditor('forward');
          },
        }
      : undefined;
  const mailDraft = editor === 'reply' || editor === 'forward';
  return (
    <aside className="sdp-ticket-pane" aria-label={`Ticket ${ticket.number}`}>
      <section className="sdp-live-detail">
        <header className="sdp-ticket-heading">
          <div className="sdp-ticket-toolbar">
            <div className="sdp-ticket-identity">
              <span className="ticket-id">#{ticket.number}</span>
              <span className="ticket-badge">{ticket.status}</span>
              {ticket.vip && <VipBadge />}
            </div>
            <TactileButton size="sm" variant="ghost" disabled={!!editor} onClick={onClose}>
              Back to Queue
            </TactileButton>
          </div>
          <h3>{ticket.subject || 'No subject'}</h3>
          <div className="sdp-ticket-heading-footer">
            <SdpReplyStatus ticket={ticket} />
            {!editor && (
              <div className="ticket-actions">
                {unassigned(ticket) && (
                  <TactileButton
                    size="sm"
                    disabled={locked || !live || pickUp.confirming}
                    onClick={pickUp.begin}
                  >
                    Pick Up
                  </TactileButton>
                )}
                <TactileButton
                  size="sm"
                  disabled={locked || !live}
                  onClick={() => onAction('note')}
                >
                  Add Note
                </TactileButton>
                <TactileButton
                  size="sm"
                  ref={editButton}
                  disabled={locked || !live}
                  onClick={() => onEditor('edit')}
                >
                  Edit Ticket
                </TactileButton>
                <TactileButton
                  size="sm"
                  disabled={locked || !live}
                  onClick={() => onAction('close')}
                >
                  Close Ticket
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="primary"
                  ref={replyButton}
                  disabled={locked || !live}
                  onClick={() => {
                    setSetup(TICKET_DRAFT);
                    onSection('Conversations');
                    onEditor('reply');
                  }}
                >
                  Reply
                </TactileButton>
                {/* The overflow ends the row, as on Compose. */}
                <TactileButton
                  size="sm"
                  ref={moreActions}
                  aria-label="More Actions"
                  tooltip="More Actions"
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  disabled={locked}
                  icon={<SdpMoreIcon />}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ x: rect.left, y: rect.bottom + 4 });
                  }}
                />
              </div>
            )}
          </div>
          {pickUp.confirming && !editor && (
            <div className="sdp-pickup-confirm" role="group" aria-label="Confirm pick up">
              <span>
                Assign #{ticket.number} to you in SDP? SDP workflows may send notifications.
              </span>
              <TactileButton
                size="sm"
                variant="primary"
                disabled={locked || !live}
                onClick={() => void pickUp.confirm()}
              >
                {pickUp.saving ? 'Picking Up…' : 'Confirm Pick Up'}
              </TactileButton>
              <TactileButton size="sm" disabled={pickUp.saving} onClick={pickUp.cancel}>
                Cancel
              </TactileButton>
            </div>
          )}
          <SdpMessage message={pickUp.message} />
          {ticket.replyUnread && (
            <output className="sdp-reply-update">
              <span>A reply has not been read in Relay.</span>
              <TactileButton
                size="sm"
                disabled={busy || !!editor || view?.snapshot?.source !== 'live'}
                onClick={() => onRefresh(0)}
              >
                Load Latest Reply
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
                label: 'Forward Ticket',
                disabled: busy || !live,
                onClick: () => {
                  setSetup({ withCc: false });
                  onEditor('forward');
                },
              },
              {
                label: 'Prepare Incident Bridge',
                disabled: busy || !live,
                onClick: () => {
                  moreActions.current?.focus();
                  setBridge(true);
                },
              },
              {
                label: 'Refresh Ticket',
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
                    actions={actions}
                    draft={mailDraft ? <DraftSlot host={draftHost} /> : undefined}
                    draftAt={setup.at}
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
            {editor === 'edit' && (
              <div className="sdp-inline-editor" ref={draft} tabIndex={-1}>
                <SdpNativeEditor
                  key={`${ticket.id}-${editor}`}
                  ticket={ticket}
                  mode={editor}
                  onClose={() => onEditor(undefined)}
                  onResult={onResult}
                />
              </div>
            )}
            {mailDraft && !detail && <DraftSlot host={draftHost} />}
            {mailDraft &&
              createPortal(
                <SdpNativeEditor
                  key={`${ticket.id}-${editor}`}
                  ticket={ticket}
                  mode={editor}
                  sourceId={editor === 'forward' ? setup.sourceId : undefined}
                  quote={editor === 'reply' ? setup.quote : undefined}
                  withCc={setup.withCc}
                  onClose={() => onEditor(undefined)}
                  onResult={onResult}
                />,
                draftHost,
              )}
          </div>
          <section className="sdp-ticket-inspector" aria-label="Ticket overview">
            <h4 className="toolbar-title">Ticket overview</h4>
            <SdpTicketOverview ticket={ticket} />
            {detail && (
              <p className="sdp-ticket-source">
                <span className={live ? 'tab-page-status' : undefined}>
                  {live ? 'Live from SDP' : 'Saved copy · Read only'}
                </span>
                {view?.detailSnapshot && (
                  <time dateTime={new Date(view.detailSnapshot.fetchedAt).toISOString()}>
                    Updated {formatOpsTime(view.detailSnapshot.fetchedAt)}
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
