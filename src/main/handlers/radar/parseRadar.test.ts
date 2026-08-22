import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  looksLikeSignInPage,
  parseBoard,
  parseStatusColor,
  parseXCenterCounts,
} from './parseRadar';

/**
 * The fixture is a real saved copy of the CW Dispatcher Radar page, so these
 * assertions pin the parser to markup the dashboard actually emits rather than
 * to a hand-written approximation of it.
 */
const FIXTURE = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'radar', 'radar-green.html'),
  'utf8',
);

describe('parseStatusColor', () => {
  it('reads the status bar colour from the real dashboard', () => {
    expect(parseStatusColor(FIXTURE)).toBe('green');
  });

  it('reads the colour regardless of class order', () => {
    expect(parseStatusColor('<td class="statusBar red"></td>')).toBe('red');
    expect(parseStatusColor('<td class="yellow statusBar"></td>')).toBe('yellow');
  });

  it('ignores colour classes that are not on the status bar', () => {
    expect(parseStatusColor('<td class="green name">prod01</td>')).toBe('unknown');
  });

  it('reports unknown rather than guessing when the bar carries no colour', () => {
    expect(parseStatusColor('<td class="statusBar"></td>')).toBe('unknown');
    expect(parseStatusColor('<p>no table here</p>')).toBe('unknown');
  });
});

describe('parseXCenterCounts', () => {
  it('reads OK and Pending from the real dashboard', () => {
    expect(parseXCenterCounts(FIXTURE)).toEqual({ ok: 2000, pending: 1807 });
  });

  /**
   * The page carries several other label/value count rows — queue depths, card
   * services, Order API counts. Reading them as XCenter numbers would put a
   * confidently wrong figure on an operations board.
   */
  it('does not pick up counts from outside the XCenter table', () => {
    const counts = parseXCenterCounts(FIXTURE);
    expect(counts.ok).not.toBe(6063); // Order API Counts
    expect(counts.ok).not.toBe(488); // Cardservices Requests
    expect(counts.pending).not.toBe(12534); // TRANSACTION.POST.PROCESSING.QUEUE
  });

  it('handles thousands separators', () => {
    const html = `<th>XCenter Counts:</th>
      <tr><td class="left">OK:</td><td class="right">12,345</td></tr>
      <tr><td class="left">Pending:</td><td class="right">1,807</td></tr></table>`;
    expect(parseXCenterCounts(html)).toEqual({ ok: 12345, pending: 1807 });
  });

  it('returns nulls when the table is absent', () => {
    expect(parseXCenterCounts('<p>nothing</p>')).toEqual({ ok: null, pending: null });
  });

  it('returns a null for a missing row rather than shifting values', () => {
    const html = `<th>XCenter Counts:</th>
      <tr><td class="left">Pending:</td><td class="right">42</td></tr></table>`;
    expect(parseXCenterCounts(html)).toEqual({ ok: null, pending: 42 });
  });
});

describe('parseBoard', () => {
  const board = parseBoard(FIXTURE);

  it('reads both dispatchers with their timestamps', () => {
    expect(board.dispatchers.map((d) => d.name)).toEqual(['prod01', 'prod02']);
    expect(board.dispatchers[0]).toMatchObject({
      tone: 'green',
      lastScheduleDate: '7/28/2026 2:56:10 PM',
      lastPubSubDate: '7/28/2026 2:56:20 PM',
    });
  });

  /**
   * Queue rows carry no back-reference to their dispatcher — they simply follow
   * it — so mis-ordering the walk would silently file prod01's backlog under
   * prod02.
   */
  it('attaches each queue run to the dispatcher it follows', () => {
    expect(board.dispatchers[0]?.queues).toEqual([
      { name: 'TRANSACTION.MEMBERSHIPS.ERROR.QUEUE', depth: 1323 },
      { name: 'TRANSACTION.MEMBERSHIPS.SUBMIT.QUEUE', depth: 3163 },
      { name: 'TRANSACTION.POST.PROCESSING.QUEUE', depth: 12534 },
      { name: 'TRANSACTION.POST.PROCESSING.QUEUE.ERROR.NathanPlemons', depth: 1 },
    ]);
    expect(board.dispatchers[1]?.queues).toEqual([]);
  });

  it('reads the PaPA message types separately from the queues', () => {
    expect(board.papa).toEqual([
      { name: 'READY', depth: 0 },
      { name: 'UNACKED', depth: 0 },
    ]);
  });

  it('splits the single-line metrics into label and value', () => {
    expect(board.metrics).toContainEqual({
      label: 'Cardservices Requests (Last Hour)',
      value: '488',
      tone: 'green',
    });
    expect(board.metrics).toContainEqual({
      label: 'Order API Counts',
      value: '6063',
      tone: 'green',
    });
  });

  /** The EDW row is a colour-only status; inventing a value would be wrong. */
  it('keeps a colour-only metric valueless and carries its own tone', () => {
    expect(board.metrics).toContainEqual({
      label: 'EDW Daily Load Date Status',
      value: null,
      tone: 'yellow',
    });
  });

  it('reads the board clock without its label', () => {
    expect(board.currentTime).toBe('7/28/2026 2:57:01 PM');
  });

  it('does not mistake the PaPA section title for a dispatcher', () => {
    expect(board.dispatchers.map((d) => d.name)).not.toContain('PaPA Processor Service');
  });

  /** The XCenter figures are read separately; its rows must not leak in. */
  it('keeps the nested XCenter table out of the queue runs', () => {
    const everyRow = [...board.papa, ...board.dispatchers.flatMap((d) => d.queues)];
    expect(everyRow.map((row) => row.name)).not.toContain('OK:');
    expect(everyRow.map((row) => row.name)).not.toContain('Pending:');
  });

  it('returns an empty board for a page that is not the dashboard', () => {
    const empty = parseBoard('<html><body>Service Unavailable</body></html>');
    expect(empty).toEqual({
      color: 'unknown',
      dispatchers: [],
      papa: [],
      metrics: [],
      currentTime: null,
    });
  });
});

describe('looksLikeSignInPage', () => {
  it('does not mistake the dashboard for the login form', () => {
    expect(looksLikeSignInPage(FIXTURE)).toBe(false);
  });

  it('detects a password field', () => {
    expect(looksLikeSignInPage('<input name="pw" type="password">')).toBe(true);
  });

  it('detects a login form without a password input on the first step', () => {
    expect(looksLikeSignInPage('<form action="/Account/Login">')).toBe(true);
  });
});
