/** Display helpers shared by the live queue table and the ticket inspector. */
import { Tooltip } from '../../components/Tooltip';
import { formatMessageTime } from '../../utils/opsTime';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** SDP sends "No technician" for unassigned requests; keep empty values on the same wording. */
export const technicianLabel = (technician: string): string => technician || 'No technician';

/** SDP's purple VIP marker for a ticket whose requester is a VIP user. */
export function VipBadge() {
  return <span className="sdp-vip-badge">VIP</span>;
}
/** Tickets from VIP requesters lead the list; otherwise SDP's order is kept. */
export function vipFirst<T extends Readonly<{ vip?: true }>>(tickets: readonly T[]): T[] {
  return [...tickets.filter((ticket) => ticket.vip), ...tickets.filter((ticket) => !ticket.vip)];
}
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
    lets keyboard users reach it in the ticket workspace. */
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

const CREATED_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const CREATED_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Local 12-hour creation time for queue rows ("Oct 6, 12:12 PM"; the year shows outside the
    current one). The Tooltip adds the year and time zone without adding a row tab stop. */
export function CreatedTime({ createdAt }: Readonly<{ createdAt: number | null }>) {
  if (createdAt === null) return <span className="sdp-created">Not set</span>;
  const exact = new Date(createdAt);
  const format =
    exact.getFullYear() === new Date().getFullYear() ? CREATED_FORMAT : CREATED_YEAR_FORMAT;
  return (
    <Tooltip content={`Created ${formatMessageTime(exact)}`}>
      <time className="sdp-created" dateTime={exact.toISOString()}>
        {format.format(exact)}
      </time>
    </Tooltip>
  );
}
