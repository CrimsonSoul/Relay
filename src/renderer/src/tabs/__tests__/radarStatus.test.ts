import { describe, expect, it } from 'vitest';
import { deriveRadarStatus } from '../radarStatus';
import { formatOpsTime } from '../../utils/opsTime';

const live = { color: 'red', lastUpdated: 1_000, signInRequired: false, error: null } as const;
const FAILING_SINCE = Date.parse('2026-07-28T19:05:00Z');

describe('deriveRadarStatus', () => {
  it('names why there is no data before the first good snapshot', () => {
    expect(deriveRadarStatus({ ...live, lastUpdated: 0 })).toEqual({
      state: 'no-data',
      tone: 'unknown',
      label: 'Waiting for data',
      description: 'Waiting for the first Radar update',
      failingSince: null,
    });
    // A hard failure must never read as a neutral "Unknown" beside the error, nor share the
    // waiting pip: it gets the `failed` tone.
    expect(deriveRadarStatus({ ...live, lastUpdated: 0, error: 'ECONNREFUSED' })).toEqual({
      state: 'no-data',
      tone: 'failed',
      label: 'Unavailable',
      description: 'Radar unavailable: no data has loaded and the last refresh failed',
      failingSince: null,
    });
    const signIn = deriveRadarStatus({ ...live, lastUpdated: 0, signInRequired: true });
    expect(signIn).toMatchObject({
      state: 'no-data',
      tone: 'unknown',
      label: 'Sign-in needed',
      description: 'No Radar data yet: sign in to CW Dashboard to load the board',
    });
  });

  it('says how long the feed has been failing', () => {
    const since = formatOpsTime(FAILING_SINCE);
    expect(since).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(
      deriveRadarStatus({
        ...live,
        lastUpdated: 0,
        error: 'ECONNREFUSED',
        failingSince: FAILING_SINCE,
      }),
    ).toMatchObject({
      tone: 'failed',
      failingSince: since,
      description: `Radar unavailable: no data has loaded; refreshes failing since ${since}`,
    });
    expect(
      deriveRadarStatus({ ...live, error: 'timeout', failingSince: FAILING_SINCE }),
    ).toMatchObject({
      tone: 'failed',
      description: `Stale: showing the last good board; refreshes failing since ${since}`,
    });
  });

  it('reports Stale when retained data exists but the latest refresh failed or needs sign-in', () => {
    expect(deriveRadarStatus({ ...live, error: 'timeout' })).toEqual({
      state: 'stale',
      tone: 'failed',
      label: 'Stale',
      description: 'Stale: showing the last good board; the latest refresh failed',
      failingSince: null,
    });
    expect(deriveRadarStatus({ ...live, signInRequired: true })).toMatchObject({
      label: 'Stale',
      tone: 'unknown',
    });
  });

  it('reports the board colour and its word when the snapshot is current', () => {
    expect(deriveRadarStatus(live)).toEqual({
      state: 'live',
      tone: 'red',
      label: 'Critical',
      description: 'Board Critical',
      failingSince: null,
    });
    expect(deriveRadarStatus({ ...live, color: 'green' }).label).toBe('Healthy');
  });
});
