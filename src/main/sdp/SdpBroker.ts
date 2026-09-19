import { latestReply, SdpReplyTracker } from './SdpReplies';
import {
  readForm,
  readOptions,
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
import { readResources } from './SdpResources';
import { readTicketRelations } from './SdpTicketRelations';
import { mutationBaseline, submitMutation } from './SdpMutations';
import type { SdpReview } from '@shared/sdpMutation';
import { SdpProvider, SdpProviderError, SDP_ACCOUNTS } from './SdpProvider';
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
  private connections = new Map<string, Connection>();
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
    if (command.action === 'clearCopies') return this.clearCopies(active);
    if (command.action === 'monitorQueues') return this.monitor(id, active, ensureCurrent, command);
    if (active.reading) throw new Error('An SDP operation is already in progress.');
    active.reading = this.execute(active, ensureCurrent, command)
      .catch((error: unknown) => {
        if (error instanceof SdpFormUnavailableError) {
          ensureCurrent();
          active.form = undefined;
          return { view: { ...this.view(active), message: error.message } };
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
          | 'readReplyContext'
          | 'readTicketRelations'
          | 'readResources'
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
      case 'downloadAttachment':
        return this.download(connection, ensureCurrent, command);
      case 'readForm':
      case 'readOptions':
      case 'readReplyContext':
      case 'readTicketRelations':
        return this.form(connection, ensureCurrent, command);
      case 'readResources':
        return this.resources(connection, ensureCurrent, command);
      case 'readDetail':
        return this.readDetail(connection, ensureCurrent, command);
      default:
        return this.read(connection, ensureCurrent, command);
    }
  }
  private async form(
    connection: Connection,
    ensureCurrent: () => void,
    command: Extract<
      SdpBrokerCommand,
      { action: 'readForm' | 'readOptions' | 'readReplyContext' | 'readTicketRelations' }
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
    if (command.action === 'readTicketRelations')
      data = { ticketRelations: await readTicketRelations(...args, command) };
    else if (command.action === 'readReplyContext')
      data = { replyContext: await readReplyContext(...args, command.id) };
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
    command: Extract<SdpBrokerCommand, { action: 'readResources' }>,
  ): Promise<SdpBrokerReply> {
    if (
      !this.authorizedTicket(connection, command.id) ||
      connection.view.snapshot?.source !== 'live'
    )
      throw new Error('Load a live queue before opening ticket actions.');
    await this.refresh(connection, this.store.settings()!, ensureCurrent);
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
      (!this.authorizedTicket(connection, mutation.id) ||
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
    const baseline =
      mutation.kind === 'create'
        ? undefined
        : await mutationBaseline(
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
      !prepared ||
      prepared.review.confirmationId !== command.confirmationId ||
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
