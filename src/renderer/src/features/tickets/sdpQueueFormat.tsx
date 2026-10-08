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
/**
 * A queue row's VIP requester marker: SDP's purple crown on its tint, so it stands out from the
 * row's line icons.
 */
export function SdpVipFlag() {
  return (
    <span className="sdp-vip-flag" role="img" aria-label="VIP requester" title="VIP requester">
      <svg
        className="sdp-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
      </svg>
    </span>
  );
}
/** Tickets from VIP requesters lead the list; otherwise SDP's order is kept. */
export function vipFirst<T extends Readonly<{ vip?: true }>>(tickets: readonly T[]): T[] {
  return [...tickets.filter((ticket) => ticket.vip), ...tickets.filter((ticket) => !ticket.vip)];
}
/** How many of four bars a priority fills, from SDP's default names and P numbers; others fill none. */
export function priorityLevel(priority: string): 0 | 1 | 2 | 3 | 4 {
  const name = priority.toLowerCase();
  if (/\b(p1|critical|urgent|emergency)\b/.test(name)) return 4;
  if (/\b(p2|high)\b/.test(name)) return 3;
  if (/\b(p3|medium|normal|moderate)\b/.test(name)) return 2;
  if (/\b(p4|p5|low|lowest|planning)\b/.test(name)) return 1;
  return 0;
}
const PRIORITY_BARS = [6, 10, 14, 18];
/**
 * A row's priority as signal bars beside its reply and notes icons: the filled bars give the level
 * and P1 and P2 are tinted too. The row's accessible name carries the priority's name.
 */
export function SdpPriorityFlag({ priority }: Readonly<{ priority: string }>) {
  const level = priorityLevel(priority);
  return (
    <span
      className={`sdp-row-flag sdp-priority-flag is-level-${level}`}
      title={`${priority} priority`}
    >
      <svg
        className="sdp-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {PRIORITY_BARS.map((height, index) => (
          <rect
            key={height}
            x={2 + index * 5.5}
            y={21 - height}
            width="4"
            height={height}
            rx="1"
            opacity={index < level ? 1 : 0.35}
          />
        ))}
      </svg>
    </span>
  );
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
