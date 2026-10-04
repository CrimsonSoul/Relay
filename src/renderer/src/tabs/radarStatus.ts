import { RADAR_STATUS_LABELS, type RadarSnapshot, type RadarStatusColor } from '@shared/ipc';
import { formatOpsTime } from '../utils/opsTime';

/** Matches the main-process poll cadence (`RADAR_REFRESH_INTERVAL_MS`, 60s). */
export const RADAR_RETRY_DESCRIPTION = 'Relay retries automatically every minute.';

type RadarStatusState =
  /** No snapshot has ever parsed — there is nothing retained to show. */
  | 'no-data'
  /** A snapshot exists, but the latest refresh failed or needs sign-in. */
  | 'stale'
  /** The latest refresh succeeded; the board colour is current. */
  | 'live';

/**
 * The board's own colours, plus `failed`: the feed itself is down (the latest refresh errored).
 * `failed` is neutral ink with its own pip shape, never alarm red, because the board's state is
 * unknown rather than critical; `unknown` (hollow ring) stays for waiting and sign-in.
 */
type RadarStatusTone = RadarStatusColor | 'failed';

type RadarStatus = {
  state: RadarStatusState;
  tone: RadarStatusTone;
  /** Short headline word(s) shown beside the status dot. */
  label: string;
  /** Plain-language sentence for tooltips and accessible names. */
  description: string;
  /** `formatOpsTime` ("2:01 PM") when the current run of failed refreshes began; null unless the feed is failing. */
  failingSince: string | null;
};

type RadarStatusInput = Pick<
  RadarSnapshot,
  'color' | 'lastUpdated' | 'signInRequired' | 'error' | 'failingSince'
>;

function failingSinceFor(snapshot: RadarStatusInput): string | null {
  if (!snapshot.error || !snapshot.failingSince) return null;
  return formatOpsTime(snapshot.failingSince);
}

function noDataStatus(snapshot: RadarStatusInput, failingSince: string | null): RadarStatus {
  if (snapshot.signInRequired) {
    return {
      state: 'no-data',
      tone: 'unknown',
      label: 'Sign-in needed',
      description: 'No Radar data yet: sign in to CW Dashboard to load the board',
      failingSince: null,
    };
  }
  if (snapshot.error) {
    return {
      state: 'no-data',
      tone: 'failed',
      label: 'Unavailable',
      description: failingSince
        ? `Radar unavailable: no data has loaded; refreshes failing since ${failingSince}`
        : 'Radar unavailable: no data has loaded and the last refresh failed',
      failingSince,
    };
  }
  return {
    state: 'no-data',
    tone: 'unknown',
    label: 'Waiting for data',
    description: 'Waiting for the first Radar update',
    failingSince: null,
  };
}

function staleDescription(snapshot: RadarStatusInput, failingSince: string | null): string {
  if (snapshot.signInRequired) {
    return 'Stale: showing the last good board; CW Dashboard sign-in has expired';
  }
  return failingSince
    ? `Stale: showing the last good board; refreshes failing since ${failingSince}`
    : 'Stale: showing the last good board; the latest refresh failed';
}

/**
 * The one place Radar's headline status is derived, so the tab header and the
 * sidebar badge can never disagree about the same snapshot. A failed first load
 * reads as "Unavailable", never "Unknown", so the headline matches the error.
 */
export function deriveRadarStatus(snapshot: RadarStatusInput): RadarStatus {
  const failingSince = failingSinceFor(snapshot);
  if (snapshot.lastUpdated === 0) return noDataStatus(snapshot, failingSince);
  if (snapshot.signInRequired || Boolean(snapshot.error)) {
    return {
      state: 'stale',
      tone: snapshot.signInRequired ? 'unknown' : 'failed',
      label: 'Stale',
      description: staleDescription(snapshot, failingSince),
      failingSince: snapshot.signInRequired ? null : failingSince,
    };
  }
  const label = RADAR_STATUS_LABELS[snapshot.color];
  return {
    state: 'live',
    tone: snapshot.color,
    label,
    description: `Board ${label}`,
    failingSince: null,
  };
}
