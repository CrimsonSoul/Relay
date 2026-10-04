/** Display helpers shared by the live queue table and the ticket inspector. */
import { Tooltip } from '../../components/Tooltip';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** SDP sends "No technician" for unassigned requests; keep empty values on the same wording. */
export const technicianLabel = (technician: string): string => technician || 'No technician';
/** Maps provider priority names to the existing semantic classes; the visible name stays the label. */
export function priorityClass(priority: string): string {
  const name = priority.toLowerCase();
  if (/\b(p1|critical|urgent|emergency)\b/.test(name)) return 'ticket-priority ticket-priority--P1';
  if (/\b(p2|high)\b/.test(name)) return 'ticket-priority ticket-priority--P2';
  return 'ticket-priority';
}

function span(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

/** Short elapsed time for queue cells, for example "5 min ago". */
export const elapsed = (at: number, now = Date.now()): string =>
  `${span(Math.max(0, now - at))} ago`;
type DueStatus = Readonly<{ label: string; className: string }>;

/** Relative due wording; overdue and due-soon states carry text, not only color. */
function dueStatus(dueAt: number, now = Date.now()): DueStatus {
  const remaining = dueAt - now;
  if (remaining < 0)
    return { label: `Overdue ${span(-remaining)}`, className: 'sdp-due ticket-overdue' };
  if (remaining < 4 * HOUR)
    return { label: `Due in ${span(remaining)}`, className: 'sdp-due ticket-due-soon' };
  if (remaining < DAY) return { label: `Due in ${span(remaining)}`, className: 'sdp-due' };
  return {
    label: new Date(dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    className: 'sdp-due',
  };
}

/** Relative due label; the exact time sits in a Tooltip, as Problems' ExactTime does. `focusable`
    lets keyboard users reach it in the ticket workspace; queue rows pass no `focusable` so each
    row stays one tab stop, and the same ticket's workspace exposes the exact time. */
export function DueTime({
  dueAt,
  focusable = false,
}: Readonly<{ dueAt: number | null; focusable?: boolean }>) {
  if (dueAt === null) return <span className="sdp-due">Not set</span>;
  const status = dueStatus(dueAt);
  const exact = new Date(dueAt);
  return (
    <Tooltip content={exact.toLocaleString()}>
      <time
        className={status.className}
        dateTime={exact.toISOString()}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={focusable ? 0 : undefined}
      >
        {status.label}
      </time>
    </Tooltip>
  );
}
