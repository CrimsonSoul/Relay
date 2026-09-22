import { expect, it } from 'vitest';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import { defaultTicketPreferences } from '@shared/serviceDesk';
import { SdpAlertEngine } from './sdpAlertEngine';
const ticket: SdpQueueTicket = {
  id: '1',
  number: '100',
  subject: 'Private subject',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Private person',
  createdAt: 100,
  dueAt: 100000,
  requestType: 'Incident',
};
const prefs = {
  ...defaultTicketPreferences(),
  rules: [
    {
      id: 'rule',
      name: 'Incidents',
      enabled: true,
      events: ['created', 'priority', 'sla-breached'] as (
        'created' | 'priority' | 'sla-breached'
      )[],
      match: 'all' as const,
      conditions: [{ field: 'requestType' as const, operator: 'is' as const, value: 'Incident' }],
      inbox: true,
      toast: true,
      desktop: true,
      sound: false,
      cooldownMinutes: 0,
    },
  ],
};
it('baselines, detects changes, applies ticket-type rules and keeps private content out of notices', () => {
  const engine = new SdpAlertEngine();
  const scan = (tickets: SdpQueueTicket[], fetchedAt: number) =>
    engine.evaluate({ tickets, fetchedAt, truncated: false }, prefs, new Set());
  expect(scan([ticket], 1000)).toEqual([]);
  const deliveries = scan([{ ...ticket, priority: 'High' }], 2000);
  expect(deliveries).toHaveLength(1);
  expect(JSON.stringify(deliveries[0]!.notice)).not.toContain('Private');
  expect(scan([{ ...ticket, priority: 'High' }], 3000)).toEqual([]);
  expect(
    scan(
      [
        { ...ticket, priority: 'High' },
        { ...ticket, id: '2', createdAt: 500, requestType: 'Incident' },
      ],
      4000,
    ),
  ).toEqual([]);
  expect(
    scan([{ ...ticket, id: '3', createdAt: 4500, requestType: 'Service request' }], 5000),
  ).toEqual([]);
  engine.reset();
  expect(scan([ticket], 110000)).toEqual([]);
  expect(scan([ticket], 120000)).toEqual([]);
});

it('ignores duplicate snapshots and resets alert comparisons when a server job restarts', () => {
  const engine = new SdpAlertEngine();
  const scan = (generation: string, fetchedAt: number, priority: string) =>
    engine.evaluate(
      { generation, fetchedAt, tickets: [{ ...ticket, priority }], truncated: false },
      prefs,
      new Set(),
    );
  expect(scan('a', 1000, 'Low')).toEqual([]);
  expect(scan('a', 2000, 'High')).toHaveLength(1);
  expect(scan('a', 2000, 'Low')).toEqual([]);
  expect(scan('b', 3000, 'Low')).toEqual([]);
});
it('detects a new ticket created during the preceding scan', () => {
  const engine = new SdpAlertEngine();
  engine.evaluate(
    { fetchedAt: 2000, startedAt: 1000, tickets: [], truncated: false },
    prefs,
    new Set(),
  );
  expect(
    engine.evaluate(
      {
        fetchedAt: 3000,
        startedAt: 2500,
        tickets: [{ ...ticket, createdAt: 1500 }],
        truncated: false,
      },
      prefs,
      new Set(),
    ),
  ).toHaveLength(1);
});
it('alerts once for a real message ID, carries sender metadata, and ignores ordinary updates', () => {
  const engine = new SdpAlertEngine();
  const replyPrefs = { ...prefs, rules: [{ ...prefs.rules[0]!, events: ['reply' as const] }] };
  const scan = (row: SdpQueueTicket, at: number) =>
    engine.evaluate({ tickets: [row], fetchedAt: at, truncated: false }, replyPrefs, new Set());
  const lastReply = {
    id: '10',
    author: 'Example requester',
    senderRole: 'requester' as const,
    at: 2000,
  };
  expect(scan({ ...ticket, lastReply }, 1000)).toEqual([]);
  expect(scan({ ...ticket, lastReply, status: 'In progress', updatedAt: 2000 }, 2000)).toEqual([]);
  const update = {
    ...ticket,
    lastReply: { ...lastReply, id: '11' },
    replyEventId: '11',
    replyUnread: true,
  };
  expect(scan(update, 3000)[0]?.notice).toMatchObject({
    event: 'reply',
    lastReply: { author: 'Example requester', senderRole: 'requester' },
  });
  expect(scan(update, 4000)).toEqual([]);
  expect(scan(ticket, 5000)).toEqual([]);
  expect(scan(update, 6000)).toEqual([]);
  expect(
    scan(
      {
        ...update,
        lastReply: { ...lastReply, id: '12', senderRole: 'technician' },
        replyEventId: '12',
      },
      7000,
    ),
  ).toHaveLength(1);
});
