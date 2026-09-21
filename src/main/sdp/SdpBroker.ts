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
import { attachmentBody, downloadAttachment } from './SdpAttachments';
import { createHash, randomUUID } from 'node:crypto';
import {
  SDP_ACCOUNT_SCOPE,
  SDP_PAGE_SIZE,
  type SdpMonitor,
  type SdpQueueTicket,
  SDP_CALLBACK,
  SdpBrokerCommandSchema,
  type SdpAccountView,
  type SdpBrokerCommand,
  type SdpBrokerReply,
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

type Connection = {
  controller: AbortController;
  revision: string;
  expires: number;
  pending?: { state: string; challenge: string; deadline: number };
  identity?: string;
  openedTicket?: SdpQueueTicket;
  monitorGeneration?: string;
  token?: string;
  refresh?: string;
  tokenExpires?: number;
  view: SdpAccountView;
  reading?: Promise<SdpBrokerReply>;
  visibleRefresh?: Promise<SdpBrokerReply>;
  nextVisibleRefreshAt?: number;
  operation: number;
  form?: import('@shared/sdpForm').SdpForm;
  refreshing?: Promise<void>;
  writing?: boolean;
  prepared?: { review: SdpReview; baseline?: string };
};
const SESSION_MS = 8 * 60 * 60 * 1000;
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
    if (command.action === 'refreshVisible') return this.refreshVisible(id, active, ensureCurrent);
    if (command.action !== 'monitorQueues') active.operation++;
    if (command.action === 'clearCopies') return this.clearCopies(active);
    if (command.action === 'monitorQueues') return this.monitor(id, active, ensureCurrent, command);
    if (active.reading) throw new Error('An SDP operation is already in progress.');
    active.reading = this.execute(active, ensureCurrent, command)
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
        if (error instanceof SdpProviderError && error.kind === 'denied') {
          this.store.remove(this.store.owner(active.identity!, active.revision));
          this.disconnectIdentity(active.identity!);
        }
        throw error;
      })
      .finally(() => {
        active.reading = undefined;
      });
    return active.reading;
  }
  private status(id: string, connection?: Connection): SdpBrokerReply {
    if (connection?.identity && !connection.reading) {
      const snapshot = this.monitors.snapshot(
        this.store.owner(connection.identity, connection.revision),
        id,
      );
      if (snapshot) this.applyMonitor(connection, snapshot);
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
    );
    const snapshot = this.monitors.snapshot(owner, id);
    if (snapshot) connection.monitorGeneration = snapshot.generation;
    if (snapshot && !connection.reading) this.applyMonitor(connection, snapshot);
    return { view: { configured: true, status: 'connected', ...result } };
  }
  private applyMonitor(connection: Connection, monitor: SdpMonitor): void {
    connection.openedTicket =
      monitor.tickets.find((ticket) => ticket.id === connection.openedTicket?.id) ??
      connection.openedTicket;
    // Filtered results can include older tickets outside the bounded monitor baseline.
    if (connection.view.queuePage?.filters) return;
    if (monitor.fetchedAt <= (connection.view.snapshot?.fetchedAt ?? 0)) return;
    const settings = this.store.settings()!;
    const queue = connection.view.queuePage?.queue ?? 'NOC';
    const page = connection.view.queuePage?.page ?? 0;
    const tickets = monitor.tickets.filter((ticket) => ticket.group === queue);
    const end = (page + 1) * SDP_PAGE_SIZE;
    connection.view.queuePage = {
      queue,
      page,
      tickets: tickets.slice(page * SDP_PAGE_SIZE, end),
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
        connection.view.message =
          'Bulk operation finished. Review each result and refresh the queue. Unconfirmed tickets are never retried automatically.';
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
      connection.view.message = 'Change confirmed by SDP. Refresh the queue to see current values.';
    } catch (error) {
      ensureCurrent();
      if (error instanceof SdpProviderError && error.kind === 'denied') throw error;
      // submitMutation emits only fixed messages, never provider bodies or ticket content.
      connection.view.message =
        error instanceof Error
          ? error.message
          : 'Change could not be confirmed. Check SDP before retrying.';
    }
    return { view: this.view(connection) };
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
      active.identity = await this.provider.identity(active.token!, active.controller.signal);
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
      // Refresh failures never authorize cached access.
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
      } catch {
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
        visibleRefresh: undefined,
        nextVisibleRefreshAt: undefined,
        refreshing: undefined,
        writing: false,
        prepared: undefined,
        form: undefined,
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
    connection.nextVisibleRefreshAt = Date.now() + 30_000;
    connection.visibleRefresh = (async (): Promise<SdpBrokerReply> => {
      try {
        await this.refresh(connection, settings, ensureCurrent);
        if (!current()) return { view: this.view(this.connections.get(id)) };
        const queuePage = queue
          ? await this.provider.queue(
              connection.token!,
              connection.controller.signal,
              queue.queue,
              queue.page,
              undefined,
              queue.filters,
            )
          : undefined;
        if (!current()) return { view: this.view(this.connections.get(id)) };
        const freshDetail = detail
          ? await this.provider.detail(
              connection.token!,
              connection.controller.signal,
              detail.id,
              detail.page,
              detail.includeAutoNotifications,
            )
          : undefined;
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
  private updateVisible(
    connection: Connection,
    queuePage: SdpAccountView['queuePage'],
    freshDetail: SdpAccountView['detail'],
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
    if (freshDetail) {
      this.store.putDetail(owner, { detail: freshDetail, fetchedAt, expiresAt });
      connection.view.detail = freshDetail;
      connection.view.detailSnapshot = snapshot;
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
      if (result.queuePage && !result.queuePage.filters)
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
    if (!this.authorizedTicket(connection, command.id) && !monitoredTicket)
      throw new Error('Load the ticket queue before opening this ticket.');
    connection.openedTicket =
      monitoredTicket ??
      connection.view.queuePage?.tickets.find((ticket) => ticket.id === command.id) ??
      connection.openedTicket;
    delete connection.view.detail;
    delete connection.view.detailSnapshot;
    try {
      await this.refresh(connection, settings, ensureCurrent);
      ensureCurrent();
      if (connection.openedTicket)
        await this.replies.refreshTicket(owner, connection.openedTicket, (ticketId) =>
          latestReply(this.provider, connection.token!, connection.controller.signal, ticketId),
        );
      ensureCurrent();
      const detail = await this.provider.detail(
        connection.token!,
        connection.controller.signal,
        command.id,
        command.page,
        command.includeAutoNotifications ?? false,
      );
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
      if (monitoredTicket && connection.view.snapshot?.source !== 'live') {
        delete connection.view.queuePage;
        connection.view.snapshot = { source: 'live', fetchedAt, expiresAt };
      }
    } catch (error) {
      ensureCurrent();
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
          connection.view.message =
            'SDP is unavailable. No saved copy of this ticket is available.';
      } else {
        connection.view = { configured: true, status: 'connected', expiresAt: connection.expires };
        return this.readFailure(connection, owner, error, { action: 'readTestTicket' });
      }
    }
    return { view: this.view(connection) };
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
    const filteredOutage = isOutage(error) && command.action === 'readQueue' && !!command.filters;
    if (filteredOutage) {
      connection.view.message = 'SDP is unavailable. Filtered results require a live connection.';
      return { view: this.view(connection) };
    }
    if (isOutage(error)) {
      const cached =
        command.action === 'readQueue'
          ? this.store.getQueue(owner, command.queue, command.page)
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
