import { hasWorkflowProblemUrl } from '@shared/sdpWorkflowLink';
import { readChanges } from './SdpChanges';
import { readHistory } from './SdpHistory';
import { prepareBulk, confirmBulk, SdpBulkDeniedError } from './SdpBulk';
import { latestReply, SdpReplyTracker } from './SdpReplies';
import {
  readForm,
  readOptions,
  readStandardOptions,
  readReplyContext,
  validateFormMutation,
  SdpFormUnavailableError,
} from './SdpForms';
import {
  attachmentBody,
  downloadAttachment,
  readInlineImage,
  type SdpImageOwner,
} from './SdpAttachments';
import {
  SDP_INLINE_IMAGE_BATCH_BYTES,
  SDP_INLINE_IMAGE_MAX_BYTES,
  sdpInlineImagePaths,
  type SdpInlineImages,
} from '@shared/sdpAttachments';
import { createHash, randomUUID } from 'node:crypto';
import {
  SDP_ACCOUNT_SCOPE,
  SDP_PAGE_SIZE,
  type SdpMonitor,
  type SdpQueuePage,
  type SdpQueueTicket,
  SDP_CALLBACK,
  SDP_VIP_FEATURE,
  SdpBrokerCommandSchema,
  type SdpAccountProfile,
  type SdpAccountView,
  type SdpBrokerCommand,
  type SdpBrokerReply,
  type SdpDetail,
} from '@shared/sdpAccount';
import { SdpQueueMonitor } from './SdpQueueMonitor';
import { readResources, readResourceChoices } from './SdpResources';
import { readTicketRelations } from './SdpTicketRelations';
import { mutationBaseline, submitMutation } from './SdpMutations';
import type { SdpReview } from '@shared/sdpMutation';
import { isObject, SdpProvider, SdpProviderError, SDP_ACCOUNTS } from './SdpProvider';
import { SdpServerStore, type SdpSettings } from './SdpServerStore';

const isOutage = (error: unknown): boolean =>
  error instanceof SdpProviderError && error.kind === 'outage';
/**
 * SDP answers 403/404 for one ticket or item that was deleted, merged or restricted. That is not a
 * token denial, so it never signs the identity out; 403 still purges saved copies (fail closed).
 * Token-level denials (401, refresh refusal, synthetic checks without an HTTP status) still revoke.
 */
const resourceRefused = (error: unknown): error is SdpProviderError =>
  error instanceof SdpProviderError &&
  error.kind === 'denied' &&
  (error.httpStatus === 403 || error.httpStatus === 404);
const RESOURCE_REFUSED_MESSAGE =
  'SDP could not find this item, or your account cannot open it. Refresh the queue and try again.';
/** Token renewal failed because Zoho or SDP is unavailable; the sign-in is kept for a later retry. */
class SdpRenewalUnavailableError extends Error {
  constructor() {
    super('SDP is unavailable, so your sign-in could not be renewed. Try again shortly.');
  }
}

type Connection = {
  controller: AbortController;
  revision: string;
  expires: number;
  pending?: { state: string; challenge: string; deadline: number };
  identity?: string;
  /** Shown back only to this person; never stored or shared with other sessions. */
  profile?: SdpAccountProfile;
  openedTicket?: SdpQueueTicket;
  monitorGeneration?: string;
  token?: string;
  refresh?: string;
  tokenExpires?: number;
  view: SdpAccountView;
  /** The latest foreground operation; each new one waits for it (see FOREGROUND_BACKLOG). */
  reading?: Promise<SdpBrokerReply>;
  /** Foreground operations waiting for an earlier one to finish. */
  waiting?: number;
  visibleRefresh?: Promise<SdpBrokerReply>;
  /** Inline image reads run one batch at a time, beside the one-operation lock. */
  imageRead?: Promise<unknown>;
  /** The open ticket's last live content; its images stay readable while it is read again. */
  imageDetail?: { detail: SdpDetail; expires: number };
  /** Queue note flags, like image reads, run beside the lock; flags are kept per ticket version. */
  notesRead?: Promise<unknown>;
  noteFlags?: Map<string, { updatedAt: number | null; checkedAt: number; hasNotes: boolean }>;
  /** The latest live search results, which this session may then open; never stored. */
  searchResults?: { tickets: Map<string, SdpQueueTicket>; expires: number };
  searchRead?: Promise<unknown>;
  nextVisibleRefreshAt?: number;
  operation: number;
  form?: import('@shared/sdpForm').SdpForm;
  refreshing?: Promise<void>;
  writing?: boolean;
  prepared?: { review: SdpReview; baseline?: string };
};
const SESSION_MS = 8 * 60 * 60 * 1000;
/**
 * Foreground operations run one at a time in arrival order, because a ticket's panels (history,
 * linked tickets, resources) load together. Beyond this many waiting, SDP is too slow to queue more.
 */
const FOREGROUND_BACKLOG = 8;
/**
 * A reply for a Relay client that did not name SDP_VIP_FEATURE in SDP_FEATURES_HEADER: every
 * ticket's `vip` is left out, because older clients reject unknown fields.
 */
export function withoutSdpVip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSdpVip);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'vip')
      .map(([key, entry]) => [key, withoutSdpVip(entry)]),
  );
}
/** Whether a Relay client's SDP_FEATURES_HEADER names SDP_VIP_FEATURE. */
export function acceptsSdpVip(header: string | string[] | undefined): boolean {
  const values = Array.isArray(header) ? header : [header ?? ''];
  return values.some((value) =>
    value
      .split(',')
      .map((feature) => feature.trim().toLowerCase())
      .includes(SDP_VIP_FEATURE),
  );
}
/** A filtered or sorted page is never saved, so an outage cannot substitute a saved copy for it. */
function liveOnlyOutage(
  error: unknown,
  command: Extract<SdpBrokerCommand, { action: 'readQueue' | 'readTestTicket' }>,
): string | undefined {
  if (!isOutage(error) || command.action !== 'readQueue') return undefined;
  if (command.filters) return 'SDP is unavailable. Filtered results require a live connection.';
  if (command.sort) return 'SDP is unavailable. Sorted results require a live connection.';
  return undefined;
}
/** Server only. Connections are bound to authenticated Relay sessions; identities come from Zoho. */
export class SdpBroker {
  private readonly monitorSuspended = new Set<string>();
  private readonly replies = new SdpReplyTracker();
  private readonly monitors = new SdpQueueMonitor();
  private readonly connections = new Map<string, Connection>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    readonly store: SdpServerStore,
    private readonly provider = new SdpProvider(),
  ) {
    this.timer = setInterval(() => {
      for (const [id, connection] of this.connections)
        if (connection.expires <= Date.now()) this.disconnect(id);
      this.store.prune();
    }, 60_000);
    this.timer.unref();
  }
  disconnect(id: string): void {
    const connection = this.connections.get(id);
    this.monitors.unsubscribe(id);
    connection?.controller.abort();
    this.connections.delete(id);
    if (
      connection?.identity &&
      ![...this.connections.values()].some(
        (peer) => peer.identity === connection.identity && peer.revision === connection.revision,
      )
    )
      this.replies.clear(this.store.owner(connection.identity, connection.revision));
  }
  reset(): void {
    for (const id of this.connections.keys()) this.disconnect(id);
  }
  dispose(): void {
    clearInterval(this.timer);
    this.reset();
    this.monitors.dispose();
    this.store.close();
  }
  private current(id: string, connection: Connection): boolean {
    return (
      this.connections.get(id) === connection &&
      !connection.controller.signal.aborted &&
      connection.expires > Date.now() &&
      this.store.settings()?.revision === connection.revision
    );
  }
  private view(connection?: Connection): SdpAccountView {
    if (!connection) return { configured: !!this.store.settings()?.client, status: 'disconnected' };
    if (connection.view.snapshot && connection.view.snapshot.expiresAt <= Date.now()) {
      delete connection.view.snapshot;
      delete connection.view.ticket;
      delete connection.view.queuePage;
    }
    if (connection.view.detailSnapshot && connection.view.detailSnapshot.expiresAt <= Date.now()) {
      delete connection.view.detail;
      delete connection.view.detailSnapshot;
    }
    if (connection.prepared && connection.prepared.review.expiresAt <= Date.now()) {
      connection.prepared = undefined;
      delete connection.view.review;
    }
    if (connection.pending && connection.pending.deadline <= Date.now()) {
      connection.pending = undefined;
      connection.view = {
        configured: true,
        status: 'disconnected',
        message: 'Sign-in timed out. Try again.',
      };
    }
    return this.replyView(connection);
  }
  /** The Zoho name and email go back only to the person who signed in on this connection. */
  private accountView(connection: Connection): SdpAccountView {
    const view = this.view(connection);
    return connection.profile ? { ...view, account: connection.profile } : view;
  }
  private replyView(connection: Connection): SdpAccountView {
    const view = structuredClone(connection.view);
    if (connection.identity) {
      const owner = this.store.owner(connection.identity, connection.revision);
      if (view.snapshot?.source === 'live' && view.queuePage)
        view.queuePage.tickets = this.replies.decorate(owner, view.queuePage.tickets);
      if (view.detailSnapshot?.source === 'live' && connection.openedTicket)
        view.replyActivity = this.replies.decorate(owner, [connection.openedTicket])[0];
    }
    return view;
  }
  async invoke(id: string, input: SdpBrokerCommand): Promise<SdpBrokerReply> {
    const command = SdpBrokerCommandSchema.parse(input);
    const settings = this.store.settings();
    let connection = this.connections.get(id);
    if (connection && !this.current(id, connection)) {
      this.disconnect(id);
      connection = undefined;
    }
    if (command.action === 'disconnect') {
      this.disconnect(id);
      return { view: this.view() };
    }
    if (command.action === 'status') return this.status(id, connection);
    if (!settings?.client) throw new Error('SDP server setup is required.');
    if (command.action === 'begin') return this.begin(id, command, settings);
    if (!connection) throw new Error('Sign in to SDP first.');
    const active = connection;
    const ensureCurrent = (): void => {
      if (!this.current(id, active)) throw new Error('Connection ended.');
    };
    if (command.action === 'complete')
      return this.complete(id, active, command, settings, ensureCurrent);
    if (!active.identity || !active.token) throw new Error('Sign in to SDP first.');
    switch (command.action) {
      case 'readAccount':
        return { view: this.accountView(active) };
      case 'refreshVisible':
        return this.refreshVisible(id, active, ensureCurrent);
      case 'readInlineImages':
        return this.inlineImages(active, ensureCurrent, command);
      case 'readQueueNotes':
        return this.queueNotes(active, ensureCurrent, command);
      case 'searchTickets':
        return this.searchTickets(active, ensureCurrent, command);
      case 'monitorQueues':
        return this.monitor(id, active, ensureCurrent, command);
    }
    active.operation++;
    if (command.action === 'clearCopies') return this.clearCopies(active);
    if ((active.waiting ?? 0) >= FOREGROUND_BACKLOG)
      throw new Error('An SDP operation is already in progress.');
    const previous = active.reading;
    if (previous) active.waiting = (active.waiting ?? 0) + 1;
    const operation: Promise<SdpBrokerReply> = (previous ?? Promise.resolve())
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        if (previous) active.waiting!--;
        ensureCurrent();
        return this.execute(active, ensureCurrent, command);
      })
      .catch((error: unknown): SdpBrokerReply => {
        if (error instanceof SdpFormUnavailableError) {
          ensureCurrent();
          active.form = undefined;
          return { view: { ...this.view(active), message: error.message } };
        }
        if (error instanceof SdpBulkDeniedError) {
          this.store.remove(this.store.owner(active.identity!, active.revision));
          this.disconnectIdentity(active.identity!);
          return {
            view: {
              configured: true,
              status: 'expired',
              bulkResult: error.results,
              message:
                'SDP denied access. The batch stopped; check the unconfirmed ticket before signing in again.',
            },
          };
        }
        const kept = this.keptSignInMessage(active, error);
        if (kept) {
          ensureCurrent();
          return { view: { ...this.view(active), message: kept } };
        }
        if (error instanceof SdpProviderError && error.kind === 'denied') {
          this.store.remove(this.store.owner(active.identity!, active.revision));
          this.disconnectIdentity(active.identity!);
        }
        throw error;
      })
      .finally(() => {
        if (active.reading === operation) active.reading = undefined;
      });
    active.reading = operation;
    return operation;
  }
  private status(id: string, connection?: Connection): SdpBrokerReply {
    if (connection?.identity && !connection.reading) {
      const owner = this.store.owner(connection.identity, connection.revision);
      const snapshot = this.monitors.snapshot(owner, id);
      if (snapshot) this.applyMonitor(connection, snapshot, owner, id);
    }
    return { view: this.view(connection) };
  }
  private begin(
    id: string,
    command: Extract<SdpBrokerCommand, { action: 'begin' }>,
    settings: SdpSettings,
  ): SdpBrokerReply {
    this.disconnect(id);
    if (this.connections.size >= 1000) throw new Error('Connection limit reached.');
    const connection: Connection = {
      controller: new AbortController(),
      operation: 0,
      revision: settings.revision,
      expires: Date.now() + SESSION_MS,
      pending: {
        state: command.state,
        challenge: command.challenge,
        deadline: Date.now() + 300_000,
      },
      view: { configured: true, status: 'connecting' },
    };
    this.connections.set(id, connection);
    const url = new URL(`${SDP_ACCOUNTS}/oauth/v2/auth`);
    url.search = new URLSearchParams({
      client_id: settings.client!.clientId,
      response_type: 'code',
      redirect_uri: SDP_CALLBACK,
      scope: SDP_ACCOUNT_SCOPE,
      state: command.state,
      code_challenge_method: 'S256',
      code_challenge: command.challenge,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();
    return { view: this.view(connection), authorizationUrl: url.toString() };
  }
  private execute(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<
      SdpBrokerCommand,
      {
        action:
          | 'prepareChange'
          | 'confirmChange'
          | 'cancelChange'
          | 'downloadAttachment'
          | 'readForm'
          | 'readOptions'
          | 'readChanges'
          | 'verifyWorkflowTicket'
          | 'readStandardOptions'
          | 'readForwardContext'
          | 'readReplyContext'
          | 'readHistory'
          | 'readTicketRelations'
          | 'readResources'
          | 'readResourceChoices'
          | 'readDetail'
          | 'readQueue'
          | 'readTestTicket';
      }
    >,
  ): Promise<SdpBrokerReply> {
    switch (command.action) {
      case 'prepareChange':
      case 'confirmChange':
      case 'cancelChange':
        return this.change(connection, ensureCurrent, command);
      case 'verifyWorkflowTicket':
        return this.verifyWorkflowTicket(connection, ensureCurrent, command);
      case 'readChanges':
        return this.changes(connection, ensureCurrent, command);
      case 'readStandardOptions':
        return this.standardOptions(connection, ensureCurrent, command);
      case 'downloadAttachment':
        return this.download(connection, ensureCurrent, command);
      case 'readForm':
      case 'readOptions':
      case 'readForwardContext':
      case 'readReplyContext':
      case 'readHistory':
      case 'readTicketRelations':
        return this.form(connection, ensureCurrent, command);
      case 'readResourceChoices':
      case 'readResources':
        return this.resources(connection, ensureCurrent, command);
      case 'readDetail':
        return this.readDetail(connection, ensureCurrent, command);
      default:
        return this.read(connection, ensureCurrent, command);
    }
  }
  private async verifyWorkflowTicket(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'verifyWorkflowTicket' }>,
  ): Promise<SdpBrokerReply> {
    const owner = this.store.owner(connection.identity!, connection.revision);
    const monitor = this.monitors.snapshot(owner);
    if (
      !monitor ||
      monitor.generation !== connection.monitorGeneration ||
      Date.now() - monitor.fetchedAt >= 75_000 ||
      !monitor.tickets.some((ticket) => ticket.id === command.id)
    )
      throw new Error('Wait for a current ticket queue scan before linking.');
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    ensureCurrent();
    const value = await this.provider.json(
      `https://support.campingworld.com/app/itdesk/api/v3/requests/${command.id}`,
      connection.controller.signal,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${connection.token!}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      },
    );
    ensureCurrent();
    if (
      !isObject(value) ||
      !isObject(value.request) ||
      String(value.request.id) !== command.id ||
      (value.request.description != null && typeof value.request.description !== 'string')
    )
      throw new SdpProviderError('invalid');
    return {
      view: {
        configured: true,
        status: 'connected',
        workflowTicketMatch: hasWorkflowProblemUrl(
          String(value.request.description ?? ''),
          command.environment,
          command.problemId,
        ),
      },
    };
  }
  private async changes(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readChanges' }>,
  ): Promise<SdpBrokerReply> {
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    try {
      const changesPage = await readChanges(
        this.provider,
        connection.token!,
        connection.controller.signal,
        command,
      );
      ensureCurrent();
      return { view: { configured: true, status: 'connected', changesPage } };
    } catch (error) {
      // Missing Changes permission must not disconnect an otherwise valid ticket account.
      if (
        error instanceof SdpProviderError &&
        error.kind === 'denied' &&
        error.httpStatus === 403
      ) {
        ensureCurrent();
        return {
          view: {
            configured: true,
            status: 'connected',
            message:
              'Changes access is unavailable. Reconnect your work account to grant Changes read access, or ask your SDP administrator for permission.',
          },
        };
      }
      throw error;
    }
  }
  private async standardOptions(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readStandardOptions' }>,
  ): Promise<SdpBrokerReply> {
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    const options = await readStandardOptions(
      this.provider,
      connection.token!,
      connection.controller.signal,
      command,
    );
    ensureCurrent();
    return { view: { ...this.view(connection), options } };
  }
  private async form(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<
      SdpBrokerCommand,
      {
        action:
          | 'readForm'
          | 'readOptions'
          | 'readReplyContext'
          | 'readForwardContext'
          | 'readTicketRelations'
          | 'readHistory';
      }
    >,
  ): Promise<SdpBrokerReply> {
    if (
      !this.authorizedTicket(connection, command.id) ||
      connection.view.snapshot?.source !== 'live'
    )
      throw new Error('Load a live ticket first.');
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    const args = [this.provider, connection.token!, connection.controller.signal] as const;
    let data: Partial<SdpAccountView>;
    if (command.action === 'readHistory') data = { history: await readHistory(...args, command) };
    else if (command.action === 'readTicketRelations')
      data = { ticketRelations: await readTicketRelations(...args, command) };
    else if (command.action === 'readReplyContext' || command.action === 'readForwardContext')
      data = {
        replyContext: await readReplyContext(
          ...args,
          command.id,
          command.action === 'readForwardContext',
          command.action === 'readForwardContext' ? command.sourceId : undefined,
        ),
      };
    else if (command.action === 'readForm') {
      connection.form = await readForm(...args, command.id);
      data = { form: connection.form };
    } else {
      if (connection.form?.id !== command.id) throw new Error('Load this ticket form first.');
      data = { options: await readOptions(...args, command, connection.form) };
    }
    ensureCurrent();
    return { view: { configured: true, status: 'connected', ...data } };
  }
  private async download(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'downloadAttachment' }>,
  ): Promise<SdpBrokerReply> {
    if (
      !this.authorizedTicket(connection, command.id) ||
      connection.view.snapshot?.source !== 'live'
    )
      throw new Error('Load a live queue first.');
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    const attachmentFile = await downloadAttachment(
      this.provider,
      connection.token!,
      connection.controller.signal,
      command.id,
      command.attachmentId,
    );
    ensureCurrent();
    return { view: { configured: true, status: 'connected', attachmentFile } };
  }
  /**
   * Images in the open live ticket's messages load beside other work: they skip the one-operation
   * lock and never count as an operation, and an image SDP refuses never signs the account out.
   */
  private async inlineImages(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readInlineImages' }>,
  ): Promise<SdpBrokerReply> {
    const source = connection.imageDetail;
    if (source?.detail.id !== command.id || source.expires <= Date.now())
      throw new Error('Open this ticket from a live queue first.');
    const detail = source.detail;
    // SDP keeps an email's or note's images with that item, and description images with the request.
    const owners = new Map<string, SdpImageOwner>();
    const add = (html: string, owner: SdpImageOwner) =>
      sdpInlineImagePaths(html).forEach((path) => {
        if (!owners.has(path)) owners.set(path, owner);
      });
    add(detail.description, { id: command.id });
    add(detail.resolution ?? '', { id: command.id });
    detail.conversations.forEach((message) =>
      add(message.body, { id: command.id, item: { kind: 'notifications', id: message.id } }),
    );
    (detail.notes ?? []).forEach((note) =>
      add(note.body, { id: command.id, item: { kind: 'notes', id: note.id } }),
    );
    // An image that is not in the open ticket's content is never fetched; it shows as unavailable.
    const paths = command.paths.filter((path) => owners.has(path));
    const read = (connection.imageRead ?? Promise.resolve()).then(async () => {
      await this.refresh(connection, this.store.settings()!, ensureCurrent);
      const inlineImages: SdpInlineImages = { id: command.id, images: [], deferred: [] };
      let bytes = 0;
      for (const path of paths) {
        if (
          inlineImages.images.length &&
          bytes + SDP_INLINE_IMAGE_MAX_BYTES > SDP_INLINE_IMAGE_BATCH_BYTES
        ) {
          inlineImages.deferred.push(path);
          continue;
        }
        const image = await readInlineImage(
          this.provider,
          connection.token!,
          connection.controller.signal,
          owners.get(path)!,
          path,
        ).catch(() => undefined);
        if (!image) continue;
        bytes += Buffer.byteLength(image.data, 'base64');
        inlineImages.images.push(image);
      }
      ensureCurrent();
      return { view: { configured: true, status: 'connected' as const, inlineImages } };
    });
    connection.imageRead = read.catch(() => undefined);
    return read;
  }
  /** Note flags for the visible live queue page, rechecked when a ticket changes or after 5 minutes. */
  private async queueNotes(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readQueueNotes' }>,
  ): Promise<SdpBrokerReply> {
    const { queuePage, snapshot } = this.view(connection);
    if (
      queuePage?.queue !== command.queue ||
      queuePage.page !== command.page ||
      snapshot?.source !== 'live'
    )
      throw new Error('Load a live queue first.');
    const tickets = queuePage.tickets;
    const read = (connection.notesRead ?? Promise.resolve()).then(async () => {
      const flags = (connection.noteFlags ??= new Map());
      const now = Date.now();
      const stale = tickets.filter((ticket) => {
        const known = flags.get(ticket.id);
        return (
          !known ||
          known.updatedAt !== (ticket.updatedAt ?? null) ||
          now - known.checkedAt >= 300_000
        );
      });
      if (stale.length) {
        await this.refresh(connection, this.store.settings()!, ensureCurrent);
        const notes = await this.provider.queueNotes(
          connection.token!,
          connection.controller.signal,
          stale.map((ticket) => ticket.id),
        );
        for (const ticket of stale)
          flags.set(ticket.id, {
            updatedAt: ticket.updatedAt ?? null,
            checkedAt: now,
            hasNotes: notes.has(ticket.id),
          });
        while (flags.size > 500) flags.delete(flags.keys().next().value!);
      }
      ensureCurrent();
      const ids = tickets
        .filter((ticket) => flags.get(ticket.id)?.hasNotes)
        .map((ticket) => ticket.id);
      return {
        view: {
          configured: true,
          status: 'connected' as const,
          queueNotes: { queue: command.queue, page: command.page, ids },
        },
      };
    });
    connection.notesRead = read.catch(() => undefined);
    return read;
  }
  private async resources(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readResources' | 'readResourceChoices' }>,
  ): Promise<SdpBrokerReply> {
    if (
      !this.authorizedTicket(connection, command.id) ||
      connection.view.snapshot?.source !== 'live'
    )
      throw new Error('Load a live queue before opening ticket actions.');
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
    if (command.action === 'readResourceChoices') {
      const resourceChoices = await readResourceChoices(
        this.provider,
        connection.token!,
        connection.controller.signal,
        command,
      );
      ensureCurrent();
      return { view: { configured: true, status: 'connected', resourceChoices } };
    }
    const resources = await readResources(
      this.provider,
      connection.token!,
      connection.controller.signal,
      command,
    );
    ensureCurrent();
    // Action data is session memory only and is never stored in shared or outage caches.
    return {
      view: { configured: true, status: 'connected', expiresAt: connection.expires, resources },
    };
  }
  private monitor(
    id: string,
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'monitorQueues' }>,
  ): SdpBrokerReply {
    const owner = this.store.owner(connection.identity!, connection.revision);
    if (command.enabled === false || this.monitorSuspended.has(owner)) {
      this.monitors.unsubscribe(id);
      connection.monitorGeneration = undefined;
      return {
        view: {
          configured: true,
          status: 'connected',
          monitoring: { state: 'off', nextCheckAt: 0 },
        },
      };
    }
    const result = this.monitors.subscribe(
      owner,
      id,
      {
        valid: () => this.current(id, connection) && !connection.writing,
        read: async (queue, page, since, signal) => {
          await this.refresh(connection, this.store.settings()!, ensureCurrent);
          ensureCurrent();
          return this.provider.queue(
            connection.token!,
            AbortSignal.any([signal, connection.controller.signal]),
            queue,
            page,
            since,
          );
        },
        enrich: async (tickets, signal) => {
          await this.refresh(connection, this.store.settings()!, ensureCurrent);
          ensureCurrent();
          return this.replies.update(owner, tickets, (ticketId) =>
            latestReply(
              this.provider,
              connection.token!,
              AbortSignal.any([signal, connection.controller.signal]),
              ticketId,
            ),
          );
        },
        denied: () => {
          this.store.remove(owner);
          this.disconnectIdentity(connection.identity!);
        },
      },
      command.after,
      command.queues,
    );
    const snapshot = this.monitors.snapshot(owner, id);
    if (snapshot) connection.monitorGeneration = snapshot.generation;
    if (snapshot && !connection.reading) this.applyMonitor(connection, snapshot, owner, id);
    return { view: { configured: true, status: 'connected', ...result } };
  }
  private applyMonitor(
    connection: Connection,
    monitor: SdpMonitor,
    owner: string,
    id: string,
  ): void {
    connection.openedTicket =
      monitor.tickets.find((ticket) => ticket.id === connection.openedTicket?.id) ??
      connection.openedTicket;
    // Filtered results can include older tickets outside the bounded monitor baseline, and the
    // monitor keeps newest-first order, so filtered and sorted pages keep their own reads.
    if (connection.view.queuePage?.filters || connection.view.queuePage?.sort) return;
    if (monitor.fetchedAt <= (connection.view.snapshot?.fetchedAt ?? 0)) return;
    const settings = this.store.settings()!;
    const queue = connection.view.queuePage?.queue ?? 'NOC';
    // An added queue not yet in this session's scan keeps its own read.
    if (!this.monitors.covers(owner, id, queue)) return;
    const page = connection.view.queuePage?.page ?? 0;
    const pageSize = connection.view.queuePage?.pageSize;
    const size = pageSize ?? SDP_PAGE_SIZE;
    const tickets = monitor.tickets.filter((ticket) => ticket.group === queue);
    const end = (page + 1) * size;
    connection.view.queuePage = {
      queue,
      page,
      ...(pageSize ? { pageSize } : {}),
      tickets: tickets.slice(page * size, end),
      hasMore: tickets.length > end,
    };
    connection.view.snapshot = {
      source: 'live',
      fetchedAt: monitor.fetchedAt,
      expiresAt: Math.min(connection.expires, monitor.fetchedAt + settings.cacheMinutes * 60_000),
    };
  }
  private authorizedTicket(connection: Connection, id: string): boolean {
    const view = this.view(connection);
    return (
      !!view.queuePage?.tickets.some((ticket) => ticket.id === id) ||
      (view.detail?.id === id && view.detailSnapshot?.source === 'live')
    );
  }
  /** A ticket in this session's latest live search, which may be opened from the results. */
  private searchedTicket(connection: Connection, id: string): SdpQueueTicket | undefined {
    const results = connection.searchResults;
    return results && results.expires > Date.now() ? results.tickets.get(id) : undefined;
  }
  /**
   * SDP-wide ticket search. Like note flags it runs beside the one-operation lock and never
   * replaces the visible queue; results are returned once and kept only to authorize opening one.
   */
  private async searchTickets(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'searchTickets' }>,
  ): Promise<SdpBrokerReply> {
    const read = (connection.searchRead ?? Promise.resolve()).then(async () => {
      const settings = this.store.settings()!;
      await this.refresh(connection, settings, ensureCurrent);
      ensureCurrent();
      const ticketSearch = await this.provider.searchTickets(
        connection.token!,
        connection.controller.signal,
        command.query,
        command.page,
      );
      ensureCurrent();
      connection.searchResults = {
        tickets: new Map(ticketSearch.tickets.map((ticket) => [ticket.id, ticket])),
        expires: Math.min(Date.now() + settings.cacheMinutes * 60_000, connection.expires),
      };
      return { view: { ...this.view(connection), ticketSearch } };
    });
    connection.searchRead = read.catch(() => undefined);
    try {
      return await read;
    } catch (error) {
      ensureCurrent();
      const kept = this.keptSignInMessage(connection, error);
      if (kept) return { view: { ...this.view(connection), message: kept } };
      if (error instanceof SdpProviderError && error.kind === 'denied') {
        this.store.remove(this.store.owner(connection.identity!, connection.revision));
        this.disconnectIdentity(connection.identity!);
      }
      throw error;
    }
  }
  private async prepare(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'prepareChange' }>,
  ): Promise<SdpBrokerReply> {
    const settings = this.store.settings()!;
    connection.prepared = undefined;
    delete connection.view.review;
    const mutation = command.mutation;
    if (mutation.kind === 'attachment') attachmentBody(mutation);
    if (
      mutation.kind !== 'create' &&
      (!(mutation.kind === 'bulk' ? mutation.ids : [mutation.id]).every((id) =>
        this.authorizedTicket(connection, id),
      ) ||
        connection.view.snapshot?.source !== 'live')
    )
      throw new Error('Refresh this ticket from a live queue before editing.');
    await this.refresh(connection, settings, ensureCurrent);
    await validateFormMutation(
      this.provider,
      connection.token!,
      connection.controller.signal,
      mutation,
    );
    ensureCurrent();
    let baseline: string | undefined;
    if (mutation.kind === 'bulk')
      baseline = await prepareBulk(
        this.provider,
        connection.token!,
        connection.controller.signal,
        mutation,
        ensureCurrent,
      );
    else if (mutation.kind !== 'create')
      baseline = await mutationBaseline(
        this.provider,
        connection.token!,
        connection.controller.signal,
        mutation.id,
        mutation,
      );
    ensureCurrent();
    const review = { confirmationId: randomUUID(), expiresAt: Date.now() + 300000, mutation };
    connection.prepared = { review, baseline };
    connection.view.review = review;
    if (mutation.kind === 'attachment')
      connection.view.review = { ...review, mutation: { ...mutation, data: '' } };
    return { view: this.view(connection) };
  }
  private async change(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<
      SdpBrokerCommand,
      { action: 'prepareChange' | 'confirmChange' | 'cancelChange' }
    >,
  ): Promise<SdpBrokerReply> {
    delete connection.view.changeResult;
    delete connection.view.bulkResult;
    delete connection.view.message;
    if (command.action === 'cancelChange') {
      connection.prepared = undefined;
      delete connection.view.review;
      return { view: this.view(connection) };
    }
    const settings = this.store.settings()!;
    if (command.action === 'prepareChange') return this.prepare(connection, ensureCurrent, command);
    const prepared = connection.prepared;
    connection.prepared = undefined;
    delete connection.view.review;
    if (
      prepared?.review.confirmationId !== command.confirmationId ||
      prepared.review.expiresAt <= Date.now()
    )
      throw new Error('This confirmation has expired or was already used.');
    const owner = this.store.owner(connection.identity!, connection.revision);
    if (this.monitorSuspended.has(owner)) throw new Error('Another SDP change is in progress.');
    connection.writing = true;
    this.monitorSuspended.add(owner);
    this.monitors.invalidate(owner);
    try {
      return await this.confirm(connection, settings, ensureCurrent, prepared);
    } finally {
      connection.writing = false;
      this.monitorSuspended.delete(owner);
    }
  }
  private async confirm(
    connection: Connection,
    settings: SdpSettings,
    ensureCurrent: () => void,
    prepared: NonNullable<Connection['prepared']>,
  ): Promise<SdpBrokerReply> {
    await this.refresh(connection, settings, ensureCurrent);
    ensureCurrent();
    const mutation = prepared.review.mutation;
    if (
      mutation.kind !== 'create' &&
      mutation.kind !== 'bulk' &&
      prepared.baseline !==
        (await mutationBaseline(
          this.provider,
          connection.token!,
          connection.controller.signal,
          mutation.id,
          mutation,
        ))
    ) {
      ensureCurrent();
      connection.view.message =
        'This ticket changed in SDP. Refresh it and review a new change before saving.';
      return { view: this.view(connection) };
    }
    ensureCurrent();
    const visible = { queue: connection.view.queuePage, detail: connection.view.detail };
    // Invalidate saved copies and peer projections before the write. A failed response can still mean success upstream.
    this.store.remove(this.store.owner(connection.identity!, connection.revision));
    for (const [id, peer] of this.connections) {
      if (peer !== connection && peer.identity === connection.identity) this.disconnect(id);
    }
    connection.view = { configured: true, status: 'connected', expiresAt: connection.expires };
    try {
      if (mutation.kind === 'bulk') {
        connection.view.bulkResult = await confirmBulk(
          this.provider,
          connection.token!,
          connection.controller.signal,
          mutation,
          prepared.baseline!,
          ensureCurrent,
        );
        ensureCurrent();
        await this.restoreVisible(
          connection,
          ensureCurrent,
          visible,
          'Bulk operation finished. Review each result. Unconfirmed tickets are never retried automatically.',
        );
        return { view: this.view(connection) };
      }
      const result = await submitMutation(
        this.provider,
        connection.token!,
        connection.controller.signal,
        mutation,
      );
      ensureCurrent();
      connection.view.changeResult = result;
      await this.restoreVisible(connection, ensureCurrent, visible, 'Change confirmed by SDP.');
    } catch (error) {
      ensureCurrent();
      if (error instanceof SdpProviderError && error.kind === 'denied') throw error;
      // submitMutation emits only fixed messages, never provider bodies or ticket content.
      const message =
        error instanceof Error
          ? error.message
          : 'Change could not be confirmed. Check SDP before retrying.';
      // A rejected or uncertain write also keeps the analyst in place, showing SDP's current values.
      await this.restoreVisible(connection, ensureCurrent, visible, message, message);
    }
    return { view: this.view(connection) };
  }
  /**
   * After a write, re-read the queue page and open ticket that were on screen so the analyst keeps
   * working in place. `outcome` is shown once they are fresh; a failed re-read keeps the cleared
   * projection and shows `stale` instead. The write result stands either way.
   */
  private async restoreVisible(
    connection: Connection,
    ensureCurrent: () => void,
    visible: { queue: SdpAccountView['queuePage']; detail: SdpAccountView['detail'] },
    outcome: string,
    stale = `${outcome} Refresh the queue to see current values.`,
  ): Promise<void> {
    connection.view.message = stale;
    if (!visible.queue && !visible.detail) return;
    try {
      const queuePage = visible.queue
        ? await this.provider.queue(
            connection.token!,
            connection.controller.signal,
            visible.queue.queue,
            visible.queue.page,
            undefined,
            visible.queue.filters,
            visible.queue.pageSize,
            visible.queue.sort,
          )
        : undefined;
      ensureCurrent();
      const freshDetail = visible.detail
        ? await this.visibleDetail(connection, visible.detail)
        : undefined;
      ensureCurrent();
      this.updateVisible(connection, queuePage, freshDetail);
      // A ticket moved out of the analyst's reach closes with the refusal beside the confirmation.
      connection.view.message =
        freshDetail instanceof SdpProviderError
          ? `${outcome} ${RESOURCE_REFUSED_MESSAGE}`
          : outcome;
    } catch {
      ensureCurrent();
    }
  }
  private async complete(
    id: string,
    active: Connection,
    command: Extract<SdpBrokerCommand, { action: 'complete' }>,
    settings: SdpSettings,
    ensureCurrent: () => void,
  ): Promise<SdpBrokerReply> {
    const pending = active.pending;
    active.pending = undefined;
    if (
      !pending ||
      pending.deadline <= Date.now() ||
      command.state !== pending.state ||
      createHash('sha256').update(command.verifier).digest('base64url') !== pending.challenge
    ) {
      this.disconnect(id);
      throw new Error('Invalid sign-in response.');
    }
    try {
      const token = await this.provider.token(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: command.code,
          client_id: settings.client.clientId,
          client_secret: settings.client.clientSecret,
          redirect_uri: SDP_CALLBACK,
          code_verifier: command.verifier,
        }),
        active.controller.signal,
      );
      ensureCurrent();
      this.setToken(active, token);
      const signedIn = await this.provider.identity(active.token!, active.controller.signal);
      active.identity = signedIn.id;
      active.profile = signedIn.profile;
      ensureCurrent();
      active.view = { configured: true, status: 'connected', expiresAt: active.expires };
      return { view: this.view(active) };
    } catch {
      if (this.connections.get(id) === active) this.disconnect(id);
      throw new Error('Work sign-in could not be verified.');
    }
  }
  private setToken(connection: Connection, value: unknown): void {
    if (!value || typeof value !== 'object') throw new SdpProviderError('invalid');
    const token = value as Record<string, unknown>;
    const seconds = Number(token.expires_in ?? token.expires_in_sec);
    if (
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      token.access_token.length > 4096 ||
      !Number.isFinite(seconds) ||
      seconds < 1 ||
      seconds > 86400 ||
      token.error
    )
      throw new SdpProviderError('denied');
    connection.token = token.access_token;
    connection.tokenExpires = Date.now() + seconds * 1000;
    if (typeof token.refresh_token === 'string' && token.refresh_token.length <= 4096)
      connection.refresh = token.refresh_token;
  }
  private async refresh(
    connection: Connection,
    settings: SdpSettings,
    ensureCurrent: () => void,
  ): Promise<void> {
    connection.refreshing ??= this.refreshToken(connection, settings, ensureCurrent);
    const pending = connection.refreshing;
    try {
      await pending;
      ensureCurrent();
    } finally {
      if (connection.refreshing === pending) connection.refreshing = undefined;
    }
  }
  private async refreshToken(
    connection: Connection,
    settings: SdpSettings,
    ensureCurrent: () => void,
  ): Promise<void> {
    if ((connection.tokenExpires ?? 0) <= Date.now() + 30_000) {
      if (!connection.refresh) throw new SdpProviderError('denied');
      // Refresh failures never authorize cached access. Only a refusal revokes the sign-in; an
      // outage or throttle keeps it (and the saved copies) for a retry once Zoho answers again.
      try {
        const result = await this.provider.token(
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: connection.refresh,
            client_id: settings.client!.clientId,
            client_secret: settings.client!.clientSecret,
          }),
          connection.controller.signal,
        );
        ensureCurrent();
        this.setToken(connection, result);
      } catch (error) {
        if (
          error instanceof SdpProviderError &&
          (error.kind === 'outage' || error.kind === 'throttled')
        )
          throw new SdpRenewalUnavailableError();
        throw new SdpProviderError('denied');
      }
    }
  }
  private clearCopies(active: Connection): SdpBrokerReply {
    this.replies.clear(this.store.owner(active.identity!, active.revision));
    this.monitors.invalidate(this.store.owner(active.identity!, active.revision));
    this.store.remove(this.store.owner(active.identity!, active.revision));
    for (const [id, connection] of this.connections) {
      if (connection.identity !== active.identity) continue;
      connection.controller.abort();
      this.connections.set(id, {
        ...connection,
        controller: new AbortController(),
        reading: undefined,
        waiting: undefined,
        visibleRefresh: undefined,
        nextVisibleRefreshAt: undefined,
        refreshing: undefined,
        writing: false,
        prepared: undefined,
        form: undefined,
        noteFlags: undefined,
        imageDetail: undefined,
        searchResults: undefined,
        monitorGeneration: undefined,
        openedTicket: undefined,
        view: {
          configured: true,
          status: 'connected',
          expiresAt: connection.expires,
          message: 'Your saved SDP copies have been cleared.',
        },
      });
    }
    return {
      view: {
        configured: true,
        status: 'connected',
        expiresAt: active.expires,
        message: 'Your saved SDP copies have been cleared.',
      },
    };
  }
  /** Refresh the current projection without interrupting foreground work or marking replies read. */
  private async refreshVisible(
    id: string,
    connection: Connection,
    ensureCurrent: () => void,
  ): Promise<SdpBrokerReply> {
    if (connection.visibleRefresh) return connection.visibleRefresh;
    if (
      connection.reading ||
      connection.writing ||
      connection.prepared ||
      Date.now() < (connection.nextVisibleRefreshAt ?? 0)
    )
      return { view: this.view(connection) };
    const view = this.view(connection);
    const queue = view.queuePage;
    const detail = view.detail;
    if (!queue && !detail) return { view };
    const operation = connection.operation;
    const current = () => this.current(id, connection) && operation === connection.operation;
    const settings = this.store.settings()!;
    const owner = this.store.owner(connection.identity!, connection.revision);
    // Clients ask every 30 seconds; a shorter window keeps a request that arrives a little early
    // from being skipped (which halved the rate) while still capping how often one session reads.
    connection.nextVisibleRefreshAt = Date.now() + 25_000;
    connection.visibleRefresh = (async (): Promise<SdpBrokerReply> => {
      try {
        await this.refresh(connection, settings, ensureCurrent);
        if (!current()) return { view: this.view(this.connections.get(id)) };
        const queuePage = queue ? await this.visibleQueue(connection, owner, queue) : undefined;
        if (!current()) return { view: this.view(this.connections.get(id)) };
        const freshDetail = detail ? await this.visibleDetail(connection, detail) : undefined;
        if (!current()) return { view: this.view(this.connections.get(id)) };
        this.updateVisible(connection, queuePage, freshDetail);
      } catch (error) {
        if (!this.current(id, connection)) return { view: this.view(this.connections.get(id)) };
        if (error instanceof SdpProviderError && error.kind === 'denied') {
          this.store.remove(owner);
          this.disconnectIdentity(connection.identity!);
          return {
            view: {
              configured: true,
              status: 'expired',
              message: 'SDP denied access. Sign in again.',
            },
          };
        }
        if (!current()) return { view: this.view(this.connections.get(id)) };
        const retryAfter = error instanceof SdpProviderError ? error.retryAfterMs : 0;
        connection.nextVisibleRefreshAt = Date.now() + Math.max(60_000, retryAfter);
        connection.view.message = 'Automatic refresh is delayed. Showing the last fetched data.';
      }
      return { view: this.view(this.connections.get(id)) };
    })().finally(() => {
      connection.visibleRefresh = undefined;
    });
    return connection.visibleRefresh;
  }
  /**
   * The visible page read again, its rows checked for replies as a queue read checks them, so a
   * new row or one due again does not wait for the next monitoring pass.
   */
  private async visibleQueue(
    connection: Connection,
    owner: string,
    queue: NonNullable<SdpAccountView['queuePage']>,
  ): Promise<SdpQueuePage> {
    const page = await this.provider.queue(
      connection.token!,
      connection.controller.signal,
      queue.queue,
      queue.page,
      undefined,
      queue.filters,
      queue.pageSize,
      queue.sort,
    );
    page.tickets = await this.replies.update(
      owner,
      page.tickets,
      (ticketId) =>
        latestReply(this.provider, connection.token!, connection.controller.signal, ticketId),
      true,
    );
    return page;
  }
  /** A deleted or restricted open ticket is returned as its refusal, never as an identity denial. */
  private async visibleDetail(
    connection: Connection,
    detail: NonNullable<SdpAccountView['detail']>,
  ): Promise<SdpAccountView['detail'] | SdpProviderError> {
    try {
      return await this.provider.detail(
        connection.token!,
        connection.controller.signal,
        detail.id,
        detail.page,
        detail.includeAutoNotifications,
      );
    } catch (error) {
      if (resourceRefused(error)) return error;
      throw error;
    }
  }
  private updateVisible(
    connection: Connection,
    queuePage: SdpAccountView['queuePage'],
    freshDetail: SdpAccountView['detail'] | SdpProviderError,
  ): void {
    const settings = this.store.settings()!;
    const owner = this.store.owner(connection.identity!, connection.revision);
    const fetchedAt = Date.now();
    const expiresAt = Math.min(fetchedAt + settings.cacheMinutes * 60_000, connection.expires);
    const snapshot = { source: 'live' as const, fetchedAt, expiresAt };
    if (queuePage) {
      if (!queuePage.filters) this.store.putQueue(owner, { queuePage, fetchedAt, expiresAt });
      connection.view.queuePage = queuePage;
      connection.view.snapshot = snapshot;
      connection.openedTicket =
        queuePage.tickets.find((ticket) => ticket.id === connection.openedTicket?.id) ??
        connection.openedTicket;
    }
    if (freshDetail instanceof SdpProviderError) {
      // The open ticket was deleted or restricted; close it without signing the identity out.
      if (freshDetail.httpStatus === 403) this.store.remove(owner);
      delete connection.view.detail;
      delete connection.view.detailSnapshot;
      connection.imageDetail = undefined;
      connection.view.message = RESOURCE_REFUSED_MESSAGE;
      return;
    }
    if (freshDetail) {
      this.store.putDetail(owner, { detail: freshDetail, fetchedAt, expiresAt });
      connection.view.detail = freshDetail;
      connection.view.detailSnapshot = snapshot;
      connection.imageDetail = { detail: freshDetail, expires: expiresAt };
    }
    delete connection.view.message;
  }
  private async read(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readQueue' | 'readTestTicket' }>,
  ): Promise<SdpBrokerReply> {
    const settings = this.store.settings()!;
    const owner = this.store.owner(connection.identity!, connection.revision);
    // Clear the previous projection before every attempt; only the explicit outage branch may restore it.
    connection.view = { configured: true, status: 'connected', expiresAt: connection.expires };
    try {
      await this.refresh(connection, settings, ensureCurrent);
      ensureCurrent();
      const result =
        command.action === 'readQueue'
          ? {
              queuePage: await this.provider.queue(
                connection.token!,
                connection.controller.signal,
                command.queue,
                command.page,
                undefined,
                command.filters,
                command.pageSize,
                command.sort,
              ),
            }
          : { ticket: await this.provider.ticket(connection.token!, connection.controller.signal) };
      ensureCurrent();
      if (result.queuePage) {
        result.queuePage.tickets = await this.replies.update(
          owner,
          result.queuePage.tickets,
          (ticketId) =>
            latestReply(this.provider, connection.token!, connection.controller.signal, ticketId),
          true,
        );
        ensureCurrent();
      }
      const fetchedAt = Date.now();
      const expiresAt = Math.min(fetchedAt + settings.cacheMinutes * 60_000, connection.expires);
      if (result.queuePage && !result.queuePage.filters && !result.queuePage.sort)
        this.store.putQueue(owner, { queuePage: result.queuePage, fetchedAt, expiresAt });
      else if (result.ticket)
        this.store.put(owner, { ticket: result.ticket, fetchedAt, expiresAt });
      connection.view = {
        ...connection.view,
        ...result,
        snapshot: { source: 'live', fetchedAt, expiresAt },
      };
    } catch (error) {
      ensureCurrent();
      if (error instanceof SdpRenewalUnavailableError) {
        connection.view.message = error.message;
        return { view: this.view(connection) };
      }
      return this.readFailure(connection, owner, error, command);
    }
    return { view: this.view(connection) };
  }
  private async readDetail(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<SdpBrokerCommand, { action: 'readDetail' }>,
  ): Promise<SdpBrokerReply> {
    const settings = this.store.settings()!;
    const owner = this.store.owner(connection.identity!, connection.revision);
    const monitor = this.monitors.snapshot(owner);
    const monitoredTicket =
      monitor &&
      monitor.generation === connection.monitorGeneration &&
      Date.now() - monitor.fetchedAt < 75_000
        ? monitor.tickets.find((ticket) => ticket.id === command.id)
        : undefined;
    // Notification links may open a ticket observed by this session's current account monitor.
    // Arbitrary IDs, other accounts, expired generations and stale scans remain ineligible.
    const searchedTicket = this.searchedTicket(connection, command.id);
    // A ticket from this session's latest live search may also be opened.
    if (!this.authorizedTicket(connection, command.id) && !monitoredTicket && !searchedTicket)
      throw new Error('Load the ticket queue before opening this ticket.');
    connection.openedTicket =
      monitoredTicket ??
      connection.view.queuePage?.tickets.find((ticket) => ticket.id === command.id) ??
      searchedTicket ??
      connection.openedTicket;
    delete connection.view.detail;
    delete connection.view.detailSnapshot;
    if (connection.imageDetail?.detail.id !== command.id) connection.imageDetail = undefined;
    try {
      await this.refresh(connection, settings, ensureCurrent);
      ensureCurrent();
      // The latest-reply check and the ticket read are independent; neither waits for the other.
      const opened = connection.openedTicket;
      const [, detail] = await Promise.all([
        opened &&
          this.replies.refreshTicket(owner, opened, (ticketId) =>
            latestReply(this.provider, connection.token!, connection.controller.signal, ticketId),
          ),
        this.provider.detail(
          connection.token!,
          connection.controller.signal,
          command.id,
          command.page,
          command.includeAutoNotifications ?? false,
        ),
      ]);
      ensureCurrent();
      const fetchedAt = Date.now();
      const expiresAt = Math.min(fetchedAt + settings.cacheMinutes * 60000, connection.expires);
      this.replies.markRead(
        owner,
        command.id,
        detail.conversations.map((message) => message.id),
      );
      this.store.putDetail(owner, { detail, fetchedAt, expiresAt });
      connection.view.detail = detail;
      connection.view.detailSnapshot = { source: 'live', fetchedAt, expiresAt };
      connection.imageDetail = { detail, expires: expiresAt };
      if (monitoredTicket && connection.view.snapshot?.source !== 'live') {
        delete connection.view.queuePage;
        connection.view.snapshot = { source: 'live', fetchedAt, expiresAt };
      }
    } catch (error) {
      ensureCurrent();
      return this.detailFailure(connection, owner, error, command);
    }
    return { view: this.view(connection) };
  }
  private detailFailure(
    connection: Connection,
    owner: string,
    error: unknown,
    command: Extract<SdpBrokerCommand, { action: 'readDetail' }>,
  ): SdpBrokerReply {
    // A failed read (refused, outage or invalid) leaves no live content to read images from.
    connection.imageDetail = undefined;
    if (isOutage(error)) {
      const saved = this.store.getDetail(
        owner,
        command.id,
        command.page,
        command.includeAutoNotifications ?? false,
      );
      if (saved) {
        connection.view.detail = saved.detail;
        connection.view.detailSnapshot = {
          source: 'outage-cache',
          fetchedAt: saved.fetchedAt,
          expiresAt: saved.expiresAt,
        };
      } else
        connection.view.message = 'SDP is unavailable. No saved copy of this ticket is available.';
      return { view: this.view(connection) };
    }
    const kept = this.keptSignInMessage(connection, error);
    if (kept) {
      connection.view.message = kept;
      return { view: this.view(connection) };
    }
    connection.view = { configured: true, status: 'connected', expiresAt: connection.expires };
    return this.readFailure(connection, owner, error, { action: 'readTestTicket' });
  }
  /**
   * Item refusals and renewal during an outage keep the sign-in. Returns the message to show, or
   * nothing when the error must take the normal denial/failure path.
   */
  private keptSignInMessage(connection: Connection, error: unknown): string | undefined {
    if (error instanceof SdpRenewalUnavailableError) return error.message;
    if (!resourceRefused(error)) return undefined;
    if (error.httpStatus === 403)
      this.store.remove(this.store.owner(connection.identity!, connection.revision));
    return RESOURCE_REFUSED_MESSAGE;
  }
  private disconnectIdentity(identity: string): void {
    for (const [id, connection] of this.connections) {
      if (connection.identity === identity) this.disconnect(id);
    }
  }
  private readFailure(
    connection: Connection,
    owner: string,
    error: unknown,
    command: Extract<SdpBrokerCommand, { action: 'readQueue' | 'readTestTicket' }>,
  ): SdpBrokerReply {
    const liveOnly = liveOnlyOutage(error, command);
    if (liveOnly) {
      connection.view.message = liveOnly;
      return { view: this.view(connection) };
    }
    if (isOutage(error)) {
      const cached =
        command.action === 'readQueue'
          ? this.store.getQueue(owner, command.queue, command.page, command.pageSize)
          : this.store.get(owner);
      if (cached)
        connection.view = {
          ...connection.view,
          ...('queuePage' in cached ? { queuePage: cached.queuePage } : { ticket: cached.ticket }),
          snapshot: {
            source: 'outage-cache',
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt,
          },
          message: 'SDP is unavailable. Showing a read-only saved copy.',
        };
      else connection.view.message = 'SDP is unavailable and no unexpired saved copy is available.';
    } else {
      this.store.remove(owner);
      if (error instanceof SdpProviderError && error.kind === 'denied') {
        // A denial revokes all connections for this provider identity, including concurrent reads.
        this.disconnectIdentity(connection.identity!);
        return {
          view: {
            configured: true,
            status: 'expired',
            message: 'SDP access could not be verified. Sign in again.',
          },
        };
      }
      connection.view.message = 'SDP returned an unexpected response. No saved copy was used.';
    }
    return { view: this.view(connection) };
  }
}
