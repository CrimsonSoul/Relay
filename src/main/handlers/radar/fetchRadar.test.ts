import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emptyRadarSnapshot, fetchRadarSnapshot } from './fetchRadar';

const FIXTURE = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'radar', 'radar-green.html'),
  'utf8',
);

describe('fetchRadarSnapshot', () => {
  it('builds a snapshot from the real dashboard', async () => {
    const snapshot = await fetchRadarSnapshot(emptyRadarSnapshot(), async () => FIXTURE);

    expect(snapshot.color).toBe('green');
    expect(snapshot.xcenter).toEqual({ ok: 2000, pending: 1807 });
    expect(snapshot.dispatchers.map((d) => d.name)).toEqual(['prod01', 'prod02']);
    expect(snapshot.papa).toHaveLength(2);
    expect(snapshot.metrics.length).toBeGreaterThan(0);
    expect(snapshot.currentTime).toBe('7/28/2026 2:57:01 PM');
    expect(snapshot.signInRequired).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(snapshot.lastUpdated).toBeGreaterThan(0);
  });

  /**
   * An expired SSO session answers 200 with the login form, so a status-code
   * check would treat the login page as a healthy board.
   */
  it('flags sign-in without overwriting the last good reading', async () => {
    const previous = await fetchRadarSnapshot(emptyRadarSnapshot(), async () => FIXTURE);

    const snapshot = await fetchRadarSnapshot(
      previous,
      async () => '<form action="/Account/Login"><input type="password"></form>',
    );

    expect(snapshot.signInRequired).toBe(true);
    expect(snapshot.color).toBe('green');
    expect(snapshot.xcenter).toEqual({ ok: 2000, pending: 1807 });
    expect(snapshot.lastUpdated).toBe(previous.lastUpdated);
  });

  it('keeps the previous reading and records why a refresh failed', async () => {
    const previous = await fetchRadarSnapshot(emptyRadarSnapshot(), async () => FIXTURE);

    const snapshot = await fetchRadarSnapshot(previous, async () => {
      throw new Error('ECONNREFUSED');
    });

    expect(snapshot.error).toBe('ECONNREFUSED');
    expect(snapshot.xcenter).toEqual({ ok: 2000, pending: 1807 });
    expect(snapshot.lastUpdated).toBe(previous.lastUpdated);
  });

  /**
   * Reporting an unparseable response as a healthy-but-unknown board would put
   * a reassuring blank on an operations screen. It has to read as broken.
   */
  it('reports a page that yields neither signal as an error', async () => {
    const snapshot = await fetchRadarSnapshot(
      emptyRadarSnapshot(),
      async () => '<html><body>Service Unavailable</body></html>',
    );

    expect(snapshot.error).toBe('Unrecognised Radar page');
    expect(snapshot.lastUpdated).toBe(0);
  });

  it('clears a previous error once a refresh succeeds', async () => {
    const failed = await fetchRadarSnapshot(emptyRadarSnapshot(), async () => {
      throw new Error('timeout');
    });
    expect(failed.error).toBe('timeout');

    const recovered = await fetchRadarSnapshot(failed, async () => FIXTURE);

    expect(recovered.error).toBeNull();
    expect(recovered.signInRequired).toBe(false);
  });

  it('clears the sign-in flag once the session is good again', async () => {
    const locked = await fetchRadarSnapshot(
      emptyRadarSnapshot(),
      async () => '<input type="password">',
    );
    expect(locked.signInRequired).toBe(true);

    const recovered = await fetchRadarSnapshot(locked, async () => FIXTURE);

    expect(recovered.signInRequired).toBe(false);
    expect(recovered.color).toBe('green');
  });

  it('passes a partial board through rather than discarding it', async () => {
    const html = '<td class="yellow statusBar"></td><p>counts unavailable</p>';

    const snapshot = await fetchRadarSnapshot(emptyRadarSnapshot(), async () => html);

    expect(snapshot.color).toBe('yellow');
    expect(snapshot.xcenter).toEqual({ ok: null, pending: null });
    expect(snapshot.dispatchers).toEqual([]);
    expect(snapshot.error).toBeNull();
  });

  it('defaults to the empty snapshot when no previous reading is given', async () => {
    const fetchHtml = vi.fn(async () => FIXTURE);

    await fetchRadarSnapshot(undefined, fetchHtml);

    expect(fetchHtml).toHaveBeenCalledOnce();
  });
});
