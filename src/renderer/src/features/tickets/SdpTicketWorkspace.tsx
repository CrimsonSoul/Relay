import { SdpHistoryPanel } from './SdpHistoryPanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BridgeGroup } from '@shared/ipc';
import type { SdpAccountView, SdpDetail, SdpQueueTicket } from '@shared/sdpAccount';
import { sdpTicketUrl } from '@shared/sdpLinks';
import { ContextMenu } from '../../components/ContextMenu';
import { TactileButton } from '../../components/TactileButton';
import { SdpIcon, SdpMoreIcon } from './SdpIcon';
import { SdpAttachmentsPanel } from './SdpAttachmentsPanel';
import { SdpNativeEditor } from './SdpNativeEditor';
import { SdpRelationships, SdpBridgeDialog } from './SdpRelationships';
import { SdpReplyStatus } from './SdpReplyStatus';
import { SdpResourcesPanel } from './SdpResourcesPanel';
import { SdpTicketContent, type SdpDetailSection } from './SdpTicketContent';
import { requesterOf, type SdpThreadActions } from './SdpConversationThread';
import { replyQuoteMarkup } from './sdpRichDraft';
import { SdpTicketRelationsPanel } from './SdpTicketRelationsPanel';
import { SdpTicketOverview } from './SdpTicketOverview';
import { SdpMessage } from './SdpMessage';
import { unassigned, useSdpPickUp } from './SdpPickUp';
import { formatOpsTime } from '../../utils/opsTime';
import { VipBadge } from './sdpQueueFormat';

/**
 * SDP's finished states, which the ticket header stamps so a closed ticket is never mistaken for
 * live work. Returns the stamp's word, or undefined while the ticket is still open.
 */
export function finishedStatus(status: string): string | undefined {
  const word = /^\s*(closed|resolved|cancell?ed)\b/i.exec(status)?.[1];
  return word && word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** A resolved ticket can still be closed; a closed or cancelled one cannot be closed again. */
export function ticketClosable(status: string): boolean {
  const finished = finishedStatus(status);
  return !finished || finished === 'Resolved';
}

/** The newest loaded email on the ticket, or the request itself when there is none. */
function newestMessage(ticket: SdpQueueTicket, detail: SdpDetail) {
  const newest = detail.conversations.reduce<SdpDetail['conversations'][number] | undefined>(
    (latest, entry) => ((entry.createdAt ?? 0) >= (latest?.createdAt ?? 0) ? entry : latest),
    undefined,
  );
  return (
    newest ?? {
      author: requesterOf(detail),
      createdAt: null,
      subject: ticket.subject,
      body: detail.description,
    }
  );
}

/** Where a reply or forward draft opens and what it starts with. */
type DraftSetup = { at?: string; sourceId?: string; quote?: string; withCc: boolean };
const TICKET_DRAFT: DraftSetup = { withCc: true };

/**
 * A draft's setup as the editor opens or closes. Every closed draft resets, so a draft opened by
 * a shortcut starts as a ticket reply, which quotes the newest message as a mail reply does.
 */
function openedDraft(
  editor: Props['editor'],
  setup: DraftSetup,
  ticket: SdpQueueTicket,
  detail: SdpDetail | undefined,
): DraftSetup {
  if (!editor) return TICKET_DRAFT;
  if (editor !== 'reply' || setup.at || setup.quote || !detail) return setup;
  return { ...setup, quote: replyQuoteMarkup(newestMessage(ticket, detail)) };
}

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
      if (host.parentNode === node) host.remove();
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
  /** Pick Up or an overview change is saving; queue navigation waits for it. */
  onOverviewBusy: (busy: boolean) => void;
  /** The ticket fills the Tickets tab instead of sharing it with the queue. */
  expanded: boolean;
  onExpand: () => void;
  onRefresh: (page: number, includeAutoNotifications?: boolean) => void;
  onClose: () => void;
}>;

function ExpandButton({
  expanded,
  onExpand,
}: Readonly<{ expanded: boolean; onExpand: () => void }>) {
  return (
    <TactileButton
      size="sm"
      variant="ghost"
      icon={<SdpIcon name={expanded ? 'collapse' : 'expand'} />}
      tooltip={
        expanded ? 'Show the queue beside the ticket (F)' : 'Fill the tab with this ticket (F)'
      }
      onClick={onExpand}
    >
      {expanded ? 'Collapse' : 'Expand'}
    </TactileButton>
  );
}

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
  expanded,
  onExpand,
  onRefresh,
  onClose,
}: Props) {
  const detail = view?.detail?.id === ticket.id ? view.detail : undefined;
  const [setup, setSetup] = useState<DraftSetup>(TICKET_DRAFT);
  const [setupFor, setSetupFor] = useState(editor);
  if (setupFor !== editor) {
    setSetupFor(editor);
    setSetup(openedDraft(editor, setup, ticket, detail));
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
  const [overviewBusy, setOverviewBusy] = useState(false);
  const pickUp = useSdpPickUp(ticket, onResult);
  useEffect(
    () => onOverviewBusy(overviewBusy || pickUp.saving),
    [overviewBusy, pickUp.saving, onOverviewBusy],
  );
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
            setSetup({ at: id, withCc: all, quote: message && replyQuoteMarkup(message) });
            onEditor('reply');
          },
          onForward: (id) => {
            setSetup({ at: id, sourceId: id === 'request' ? undefined : id, withCc: false });
            onEditor('forward');
          },
        }
      : undefined;
  const mailDraft = editor === 'reply' || editor === 'forward';
  const finished = finishedStatus(ticket.status);
  const closable = ticketClosable(ticket.status);
  return (
    <aside className="sdp-ticket-pane" aria-label={`Ticket ${ticket.number}`}>
      <section className="sdp-live-detail">
        <header className="sdp-ticket-heading">
          <div className="sdp-ticket-toolbar">
            <div className="sdp-ticket-identity">
              <span className="sdp-ticket-status">{ticket.status}</span>
              <span className="ticket-id">#{ticket.number}</span>
              {ticket.vip && <VipBadge />}
            </div>
            <div className="sdp-ticket-view-actions">
              <ExpandButton expanded={expanded} onExpand={onExpand} />
              {/* Only a narrow tab hides the queue, so only there is this the way back to it. */}
              <TactileButton
                className="sdp-ticket-back"
                size="sm"
                variant="ghost"
                disabled={!!editor}
                onClick={onClose}
              >
                Back to Queue
              </TactileButton>
            </div>
          </div>
          <div className="sdp-ticket-title">
            <h3>{ticket.subject || 'No subject'}</h3>
            {finished && (
              <p
                className="sdp-closed-stamp"
                aria-label={`This ticket is ${finished.toLowerCase()}`}
              >
                {finished}
              </p>
            )}
          </div>
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
                  tooltip="Add Note (N)"
                  disabled={locked || !live}
                  onClick={() => onAction('note')}
                >
                  Add Note
                </TactileButton>
                <TactileButton
                  size="sm"
                  ref={editButton}
                  tooltip="Edit Ticket (E)"
                  disabled={locked || !live}
                  onClick={() => onEditor('edit')}
                >
                  Edit Ticket
                </TactileButton>
                <TactileButton
                  size="sm"
                  tooltip={
                    closable
                      ? 'Close Ticket (C)'
                      : `This ticket is already ${finished?.toLowerCase()}`
                  }
                  disabled={locked || !live || !closable}
                  onClick={() => onAction('close')}
                >
                  Close Ticket
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="primary"
                  ref={replyButton}
                  tooltip="Reply (R)"
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
            <div // NOSONAR - labelled ARIA group; <fieldset> would add form-control semantics.
              className="sdp-pickup-confirm"
              role="group"
              aria-label="Confirm pick up"
            >
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
                  void globalThis.api?.openExternal(sdpTicketUrl(ticket.id)).catch(() => undefined),
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
            <SdpTicketOverview
              key={ticket.id}
              ticket={ticket}
              enabled={live && !locked && !editor}
              onBusy={setOverviewBusy}
              onResult={onResult}
            />
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
