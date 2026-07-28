import type { Session } from 'electron';
import type { RadarSnapshot } from '@shared/ipc';
import { looksLikeSignInPage, parseBoard, parseXCenterCounts } from './parseRadar';
import { getRadarSession, RADAR_URL } from './radarSession';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Electron's `Session.fetch` init type omits the standard `cache` member even
 * though Chromium's network stack honours it — the same gap `fetchNoStore`
 * documents for Node's fetch. Widening keeps `no-store` on the wire without a
 * cast, which matters here: the dashboard is a plain server-rendered page and a
 * cached copy would pin the board to stale counts.
 */
type SessionFetchInit = NonNullable<Parameters<Session['fetch']>[1]>;
type NoStoreFetchInit = SessionFetchInit & { cache: 'no-store' };

export function emptyRadarSnapshot(): RadarSnapshot {
  return {
    color: 'unknown',
    dispatchers: [],
    papa: [],
    metrics: [],
    xcenter: { ok: null, pending: null },
    currentTime: null,
    lastUpdated: 0,
    signInRequired: false,
    error: null,
  };
}

/**
 * Fetches the dashboard through the Radar session so the SSO cookie rides
 * along. Node's global `fetch` cannot see Chromium's cookie jar, which is why
 * this goes through `Session.fetch` rather than the `fetchNoStore` helper the
 * cloud-status providers share.
 */
export async function fetchRadarHtml(url: string = RADAR_URL): Promise<string> {
  const init: NoStoreFetchInit = {
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  const response = await getRadarSession().fetch(url, init);
  if (!response.ok) {
    throw new Error(`Radar responded ${response.status}`);
  }
  return response.text();
}

/**
 * Turns one fetch into a snapshot. A previous snapshot is carried forward on
 * failure so a single blip does not blank the board — the error field is what
 * tells the renderer the numbers are stale.
 */
export async function fetchRadarSnapshot(
  previous: RadarSnapshot = emptyRadarSnapshot(),
  fetchHtml: (url?: string) => Promise<string> = fetchRadarHtml,
): Promise<RadarSnapshot> {
  try {
    const html = await fetchHtml();

    // An expired session comes back as a 200 carrying the login form, so this
    // has to be decided on content rather than status code.
    if (looksLikeSignInPage(html)) {
      return { ...previous, signInRequired: true, error: null };
    }

    const board = parseBoard(html);
    const xcenter = parseXCenterCounts(html);

    // A page yielding no signal at all is not the Radar page. Reporting it as
    // an unknown-but-healthy board would be worse than saying the parse failed.
    const empty =
      board.color === 'unknown' &&
      board.dispatchers.length === 0 &&
      board.metrics.length === 0 &&
      xcenter.ok === null &&
      xcenter.pending === null;
    if (empty) {
      return { ...previous, signInRequired: false, error: 'Unrecognised Radar page' };
    }

    return {
      ...board,
      xcenter,
      lastUpdated: Date.now(),
      signInRequired: false,
      error: null,
    };
  } catch (error) {
    return {
      ...previous,
      signInRequired: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
