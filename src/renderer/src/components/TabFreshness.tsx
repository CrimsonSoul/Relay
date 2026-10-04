import { Tooltip } from './Tooltip';
import { formatOpsAge, formatOpsDateTime, formatOpsTime } from '../utils/opsTime';

type TabFreshnessProps = Readonly<{
  /** When the page's data last refreshed; nothing renders until there is one. */
  at: Date | number | string | null | undefined;
  /** The data may no longer describe the source: appends "· may be stale" in warning ink. */
  stale?: boolean;
  /** Names the moment in the Tooltip ("Last successful sync …"). */
  label?: string;
}>;

/** Age is read when the Tooltip opens, so it stays true however long the page sits on screen. */
function FreshnessDetail({ label, date }: Readonly<{ label: string; date: Date }>) {
  return <>{`${label} ${formatOpsDateTime(date)} · ${formatOpsAge(date)}`}</>;
}

/** A live-data page's freshness readout ("Updated 4:16 PM"), directly after its Refresh in the
    command bar (DESIGN.md Freshness rule). Clock time stays true however long it sits on screen;
    the exact moment and its age sit in a focusable Tooltip. */
export function TabFreshness({ at, stale = false, label = 'Last update' }: TabFreshnessProps) {
  if (at === null || at === undefined || at === '' || at === 0) return null;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const readout = `Updated ${formatOpsTime(date)}${stale ? ' · may be stale' : ''}`;

  // Width fits the shared .tooltip-popup 320px cap.
  return (
    <Tooltip content={<FreshnessDetail label={label} date={date} />} width="min(320px, 80vw)">
      {/* Focusable like Problems' ExactTime; the visible readout is its text, the exact moment
          its Tooltip description. */}
      <time
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus opens the exact-time Tooltip
        tabIndex={0}
        className={`tab-freshness${stale ? ' tab-freshness--stale' : ''}`}
        dateTime={date.toISOString()}
      >
        {readout}
      </time>
    </Tooltip>
  );
}
