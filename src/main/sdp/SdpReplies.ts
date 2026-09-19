import { emailConversationCriteria } from './SdpConversationQuery';
import { SdpLastReplySchema, type SdpLastReply } from '@shared/sdpReplies';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import { SdpProvider, SdpProviderError, isObject } from './SdpProvider';
/** Match SDP's Emails-only feed: omit internal notes, approval comments and system users. */
export async function latestReply(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  id: string,
): Promise<SdpLastReply | null> {
  if (!/^\d{1,30}$/.test(id)) throw new SdpProviderError('invalid');
  const url = new URL(
    `https://support.campingworld.com/app/itdesk/api/v3/requests/${id}/conversations`,
  );
  url.searchParams.set(
    'input_data',
    JSON.stringify({
      list_info: {
        start_index: 1,
        row_count: 1,
        sort_field: 'created_time',
        sort_order: 'desc',
        fields_required: ['id', 'type', 'created_time', 'created_by'],
        search_criteria: emailConversationCriteria(),
      },
    }),
  );
  const raw = await provider.json(url.href, signal, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.manageengine.sdp.v3+json',
    },
  });
  if (!isObject(raw) || !Array.isArray(raw.conversations) || raw.conversations.length > 1)
    throw new SdpProviderError('invalid');
  if (!raw.conversations.length) return null;
  const row: unknown = raw.conversations[0];
  if (
    !isObject(row) ||
    !isObject(row.created_by) ||
    !isObject(row.created_time) ||
    ['NOTES', 'ApprovalComments'].includes(String(row.type)) ||
    String(row.created_by.user_type) === '1'
  )
    throw new SdpProviderError('invalid');
  let senderRole: SdpLastReply['senderRole'] = 'unknown';
  if (row.created_by.is_technician === true) senderRole = 'technician';
  if (row.created_by.is_technician === false) senderRole = 'requester';
  return SdpLastReplySchema.parse({
    id: String(row.id),
    at: Number(row.created_time.value),
    author:
      typeof row.created_by.name === 'string'
        ? row.created_by.name.slice(0, 200)
        : 'Unknown sender',
    senderRole,
  });
}
type Entry = {
  signature: string;
  pending: boolean;
  visible: boolean;
  baseline: number;
  touched: number;
  checkedAt: number;
  latest?: SdpLastReply | null;
  readId?: string;
  unread: boolean;
  eventId?: string;
  eventAt?: number;
  failed: boolean;
  providerUnread: boolean;
};
type Owner = {
  entries: Map<string, Entry>;
  running?: Promise<void>;
  retryAt: number;
  focused?: string;
};
const signature = (t: SdpQueueTicket) =>
  JSON.stringify([t.updatedAt, t.notificationStatus, t.unrepliedCount]);
/** Reply metadata only, isolated by verified provider owner. No message bodies or credentials. */
export class SdpReplyTracker {
  private owners = new Map<string, Owner>();
  clear(owner: string) {
    this.owners.delete(owner);
  }
  async update(
    ownerKey: string,
    tickets: SdpQueueTicket[],
    read: (id: string) => Promise<SdpLastReply | null>,
    visible = false,
  ): Promise<SdpQueueTicket[]> {
    let owner = this.owners.get(ownerKey);
    if (!owner) {
      owner = { entries: new Map(), retryAt: 0 };
      this.owners.set(ownerKey, owner);
    }
    this.observe(owner, tickets, visible);
    await this.enqueue(ownerKey, owner, () => this.fetchPending(owner, read));
    return this.decorate(ownerKey, tickets);
  }
  async refreshTicket(
    ownerKey: string,
    ticket: SdpQueueTicket,
    read: (id: string) => Promise<SdpLastReply | null>,
  ) {
    let owner = this.owners.get(ownerKey);
    if (!owner) {
      owner = { entries: new Map(), retryAt: 0 };
      this.owners.set(ownerKey, owner);
    }
    owner.focused = ticket.id;
    this.observe(owner, [ticket], false);
    owner.entries.get(ticket.id)!.visible = true;
    await this.enqueue(ownerKey, owner, async () => {
      const entry = owner.entries.get(ticket.id)!;
      await this.readEntry(owner, ticket.id, entry, read);
    });
  }
  private async enqueue(ownerKey: string, owner: Owner, operation: () => Promise<void>) {
    const pending = (owner.running ?? Promise.resolve()).then(async () => {
      if (this.owners.get(ownerKey) === owner && owner.retryAt <= Date.now()) await operation();
    });
    owner.running = pending;
    try {
      await pending;
    } finally {
      if (owner.running === pending) owner.running = undefined;
    }
  }

  decorate(ownerKey: string, tickets: SdpQueueTicket[]): SdpQueueTicket[] {
    const entries = this.owners.get(ownerKey)?.entries;
    return tickets.map((ticket) => {
      const e = entries?.get(ticket.id);
      if (!e) return ticket;
      let replyState: 'ready' | 'pending' | 'unavailable' = 'ready';
      if (e.pending || e.latest === undefined) replyState = 'pending';
      if (e.failed) replyState = 'unavailable';
      return {
        ...ticket,
        lastReply: e.latest,
        replyState,
        replyUnread: e.unread,
        replyEventId: e.eventId,
        replyEventAt: e.eventAt,
      };
    });
  }
  markRead(ownerKey: string, id: string, deliveredIds: string[]) {
    const e = this.owners.get(ownerKey)?.entries.get(id);
    if (e?.latest && deliveredIds.includes(e.latest.id)) {
      e.readId = e.latest.id;
      e.unread = false;
    }
  }
  private observe(owner: Owner, tickets: SdpQueueTicket[], visible: boolean) {
    if (visible) for (const e of owner.entries.values()) e.visible = false;
    for (const ticket of tickets) {
      const existing = owner.entries.get(ticket.id);
      const stamp = signature(ticket);
      if (!existing) {
        owner.entries.set(ticket.id, {
          signature: stamp,
          pending: visible,
          visible,
          baseline: Date.now(),
          touched: Date.now(),
          checkedAt: 0,
          unread: false,
          failed: false,
          providerUnread: unreadReplyInSdp(ticket),
        });
        continue;
      }
      existing.touched = Date.now();
      existing.providerUnread = unreadReplyInSdp(ticket);
      existing.pending ||=
        existing.signature !== stamp ||
        ((visible || existing.visible) &&
          (existing.latest === undefined || Date.now() - existing.checkedAt >= 30000));
      existing.signature = stamp;
      existing.visible ||= visible;
    }
    for (const [id, entry] of owner.entries)
      if ((entry.visible || id === owner.focused) && Date.now() - entry.checkedAt >= 30000)
        entry.pending = true;
    while (owner.entries.size > 4000) owner.entries.delete(owner.entries.keys().next().value!);
  }
  private async fetchPending(owner: Owner, read: (id: string) => Promise<SdpLastReply | null>) {
    const work = [...owner.entries]
      .filter(([, e]) => e.pending)
      .sort(
        (a, b) =>
          Number(b[0] === owner.focused) - Number(a[0] === owner.focused) ||
          a[1].checkedAt - b[1].checkedAt,
      )
      .slice(0, 12);
    let cursor = 0;
    const worker = async () => {
      while (cursor < work.length && owner.retryAt <= Date.now()) {
        const [id, entry] = work[cursor++]!;
        await this.readEntry(owner, id, entry, read);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  private async readEntry(
    owner: Owner,
    id: string,
    entry: Entry,
    read: (id: string) => Promise<SdpLastReply | null>,
  ) {
    const stamp = entry.signature;
    try {
      const latest = await read(id);
      if (entry.signature !== stamp) return;
      this.record(entry, latest);
      entry.pending = false;
      entry.failed = false;
      entry.checkedAt = Date.now();
    } catch (error) {
      entry.failed = true;
      if (error instanceof SdpProviderError && error.kind === 'denied') throw error;
      owner.retryAt =
        Date.now() + Math.max(30000, error instanceof SdpProviderError ? error.retryAfterMs : 0);
    }
  }
  private record(entry: Entry, latest: SdpLastReply | null) {
    const changed = !!latest && latest.id !== entry.latest?.id;
    const recent =
      !!latest &&
      (entry.latest !== undefined || latest.at > entry.baseline) &&
      (!entry.latest || latest.at >= entry.latest.at);
    if (changed && recent) {
      entry.eventId = latest!.id;
      entry.eventAt = Date.now();
    }
    if (changed)
      entry.unread =
        entry.readId !== latest!.id &&
        (recent || (entry.latest === undefined && entry.providerUnread));
    if (!latest) entry.unread = false;
    entry.latest = latest;
  }
}

function unreadReplyInSdp(ticket: SdpQueueTicket): boolean {
  return ticket.providerUnread === true && !!ticket.notificationStatus?.endsWith('_REPLY');
}
