import type { SdpMonitor, SdpQueueTicket } from '@shared/sdpAccount';
import {
  quietNow,
  type TicketEventType,
  type TicketPreferences,
  type TicketRule,
} from '@shared/serviceDesk';
export type SdpNotice = {
  id: string;
  ticketId: string;
  number: string;
  event: TicketEventType;
  at: number;
  rule: string;
  lastReply?: NonNullable<SdpQueueTicket['lastReply']>;
};
export type SdpDelivery = { notice: SdpNotice; rule: TicketRule; interrupt: boolean };
export class SdpAlertEngine {
  private previous: Map<string, SdpQueueTicket> | undefined;
  private previousAt = 0;
  private generation?: string;
  private fetchedAt = 0;
  private seen = new Set<string>();
  private cooldown = new Map<string, number>();
  reset(): void {
    this.previous = undefined;
    this.previousAt = 0;
    this.generation = undefined;
    this.fetchedAt = 0;
    this.seen.clear();
    this.cooldown.clear();
  }
  evaluate(snapshot: SdpMonitor, prefs: TicketPreferences, linked: Set<string>): SdpDelivery[] {
    if (!this.accept(snapshot)) return [];
    const deliveries: SdpDelivery[] = [];
    const now = snapshot.fetchedAt;
    const next = new Map(snapshot.tickets.map((ticket) => [ticket.id, ticket]));
    for (const ticket of snapshot.tickets) {
      const events = alertEvents(
        this.previous?.get(ticket.id),
        ticket,
        this.previousAt,
        now,
        prefs.warningMinutes,
      );
      for (const event of events) {
        const key = `${ticket.id}:${event}:${eventKey(ticket, event, now)}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        if (!this.previous) continue;
        deliveries.push(...this.deliver(ticket, event, key, prefs, linked, now));
      }
    }
    this.previous = next;
    this.previousAt = scanStarted(snapshot);
    this.fetchedAt = now;
    if (this.seen.size > 10000) this.seen = new Set([...this.seen].slice(-5000));
    if (this.cooldown.size > 10000) this.cooldown.clear();
    return deliveries;
  }
  private accept(snapshot: SdpMonitor): boolean {
    if (this.generation !== snapshot.generation) this.reset();
    this.generation = snapshot.generation;
    return snapshot.fetchedAt > this.fetchedAt;
  }
  private deliver(
    ticket: SdpQueueTicket,
    event: TicketEventType,
    key: string,
    prefs: TicketPreferences,
    linked: Set<string>,
    now: number,
  ): SdpDelivery[] {
    const deliveries: SdpDelivery[] = [];
    for (const rule of prefs.rules) {
      if (!matches(rule, ticket, event, linked)) continue;
      const cooldownKey = `${rule.id}:${ticket.id}:${event}`;
      const last = this.cooldown.get(cooldownKey);
      if (last !== undefined && now - last < rule.cooldownMinutes * 60000) continue;
      this.cooldown.set(cooldownKey, now);
      deliveries.push({
        notice: {
          id: `${rule.id}:${key}`,
          ticketId: ticket.id,
          number: ticket.number,
          event,
          at: now,
          rule: rule.name,
          ...(event === 'reply' && ticket.lastReply ? { lastReply: ticket.lastReply } : {}),
        },
        rule,
        interrupt: !quietNow(prefs, now),
      });
    }
    return deliveries;
  }
}
function alertEvents(
  previous: SdpQueueTicket | undefined,
  ticket: SdpQueueTicket,
  previousAt: number,
  now: number,
  warningMinutes: number,
): TicketEventType[] {
  const events: TicketEventType[] = [];
  if (!previous) {
    if (ticket.createdAt !== null && ticket.createdAt > previousAt) events.push('created');
    else events.push('queue');
  }
  if (previous) {
    if (previous.group !== ticket.group) events.push('queue');
    if (previous.technician !== ticket.technician) events.push('assignment');
    if (previous.status !== ticket.status) events.push('status');
    if (previous.priority !== ticket.priority) events.push('priority');
  }
  events.push(...replyEvents(previous, ticket));
  events.push(...deadlineEvents(ticket, now, warningMinutes));
  return events;
}
function deadlineEvents(
  ticket: SdpQueueTicket,
  now: number,
  warningMinutes: number,
): TicketEventType[] {
  if (ticket.dueAt === null || /^(closed|resolved|cancelled|canceled)$/i.test(ticket.status))
    return [];
  if (ticket.dueAt <= now) return ['sla-breached'];
  if (ticket.dueAt - now <= warningMinutes * 60000) return ['sla-soon'];
  return [];
}
function matches(
  rule: TicketRule,
  ticket: SdpQueueTicket,
  event: TicketEventType,
  linked: Set<string>,
): boolean {
  if (!rule.enabled || !rule.events.includes(event)) return false;
  const fields: Record<string, string> = {
    ...ticket,
    assignee: ticket.technician,
    linkedProblem: String(linked.has(ticket.id)),
  } as unknown as Record<string, string>;
  const values = rule.conditions.map((condition) => {
    if (condition.field === 'majorIncident') return false;
    const actual = String(fields[condition.field] ?? '').toLowerCase();
    const expected = condition.value.toLowerCase();
    if (condition.operator === 'contains') return actual.includes(expected);
    return condition.operator === 'is' ? actual === expected : actual !== expected;
  });
  return !values.length || (rule.match === 'all' ? values.every(Boolean) : values.some(Boolean));
}

function scanStarted(snapshot: SdpMonitor): number {
  return snapshot.startedAt ?? snapshot.fetchedAt;
}

function eventKey(ticket: SdpQueueTicket, event: TicketEventType, now: number): string {
  if (event === 'reply') return String(ticket.replyEventId ?? now);
  return String(event.startsWith('sla-') ? ticket.dueAt : now);
}

function replyEvents(
  previous: SdpQueueTicket | undefined,
  ticket: SdpQueueTicket,
): TicketEventType[] {
  return ticket.replyEventId && ticket.replyEventId !== previous?.replyEventId ? ['reply'] : [];
}
