import type {
  RadarBoard,
  RadarDispatcher,
  RadarMetric,
  RadarRow,
  RadarStatusColor,
  RadarXCenterCounts,
} from '@shared/ipc';

/**
 * Reconstructs the CW Dispatcher Radar board from its HTML.
 *
 * The dashboard is a server-rendered ASP.NET page with no API behind it, so
 * this scrapes. It follows the regex approach the RSS cloud-status provider
 * uses rather than pulling an HTML parser into main for one page.
 *
 * The page is one flat run of <tr>s whose meaning comes from the classes on
 * their cells, not from nesting, so this walks the rows in order and classifies
 * each one. Anything unrecognised is skipped rather than guessed at: a silently
 * wrong figure on an operations board is worse than a missing one.
 */

const STATUS_COLORS = ['green', 'yellow', 'red', 'magenta'] as const;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Strips markup from a cell and collapses the page's generous whitespace.
 *
 * The quantifiers are bounded rather than open-ended. `<[^>]*>` is quadratic on
 * a run of unclosed `<`, and this parses a response from a remote host, so the
 * input is not something to assume good shape from. Tags and entities on this
 * page are far shorter than these ceilings.
 */
function textOf(html: string): string {
  return html
    .replaceAll(/<[^>]{0,2048}>/g, ' ')
    .replaceAll(/&[a-z]{1,10};|&#\d{1,6};/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replaceAll(/\s{1,256}/g, ' ')
    .trim();
}

function toneOf(classNames: string): RadarStatusColor {
  const names = new Set(classNames.toLowerCase().split(/\s+/));
  return STATUS_COLORS.find((color) => names.has(color)) ?? 'unknown';
}

function toCount(raw: string): number | null {
  const digits = /-?[\d,]+/.exec(raw);
  if (!digits) return null;
  const value = Number.parseInt(digits[0].replaceAll(',', ''), 10);
  return Number.isFinite(value) ? value : null;
}

type Cell = { classNames: string; html: string; text: string };

function cellsOf(rowHtml: string): Cell[] {
  const cells: Cell[] = [];
  const cellRegex = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(rowHtml)) !== null) {
    const attributes = match[1] ?? '';
    const html = match[2] ?? '';
    const classNames = /\bclass=["']([^"']*)["']/i.exec(attributes)?.[1] ?? '';
    cells.push({ classNames, html, text: textOf(html) });
  }
  return cells;
}

function rowsOf(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');
}

/**
 * The overall signal is the 25px bar in the leftmost cell,
 * `<td class="green statusBar">`. The colour class may sit on either side of
 * `statusBar`, so this matches the whole class list and looks inside it.
 */
export function parseStatusColor(html: string): RadarStatusColor {
  const match = /<td[^>]*\bclass=["']([^"']*\bstatusBar\b[^"']*)["']/i.exec(html);
  return match?.[1] ? toneOf(match[1]) : 'unknown';
}

/**
 * Narrows to the XCenter table before reading numbers. The page carries other
 * label/value count rows — queue depths, Order API counts — that would
 * otherwise match the same shape.
 */
function extractXCenterSection(html: string): string | null {
  const heading = /XCenter\s+Counts\s*:?/i.exec(html);
  if (!heading) return null;
  const rest = html.slice(heading.index);
  const tableEnd = rest.search(/<\/table\s*>/i);
  return tableEnd === -1 ? rest : rest.slice(0, tableEnd);
}

function readLabelledCount(section: string, label: string): number | null {
  const pattern = new RegExp(String.raw`>\s*${label}\s*:?\s*</td>\s*<td[^>]*>\s*([\d,]+)\s*<`, 'i');
  const match = pattern.exec(section);
  return match?.[1] ? toCount(match[1]) : null;
}

export function parseXCenterCounts(html: string): RadarXCenterCounts {
  const section = extractXCenterSection(html);
  if (!section) return { ok: null, pending: null };
  return {
    ok: readLabelledCount(section, 'OK'),
    pending: readLabelledCount(section, 'Pending'),
  };
}

/** Removes the nested XCenter table so its rows do not enter the row walk. */
function withoutXCenterTable(html: string): string {
  const heading = /XCenter\s+Counts\s*:?/i.exec(html);
  if (!heading) return html;
  const tableStart = html.lastIndexOf('<table', heading.index);
  const tableEnd = html.indexOf('</table>', heading.index);
  if (tableStart === -1 || tableEnd === -1) return html;
  return html.slice(0, tableStart) + html.slice(tableEnd + '</table>'.length);
}

/**
 * `Cardservices Requests (Last Hour): 488` and friends put the label and the
 * figure in one cell. The EDW row has no figure at all — only a colour — so
 * `value` stays null there rather than being invented.
 */
function toMetric(cell: Cell): RadarMetric {
  const separator = cell.text.lastIndexOf(':');
  const tone = toneOf(cell.classNames);
  if (separator === -1) {
    return { label: cell.text, value: null, tone };
  }
  const label = cell.text.slice(0, separator).trim();
  const value = cell.text.slice(separator + 1).trim();
  return value ? { label, value, tone } : { label, value: null, tone };
}

/**
 * What a single row of the board turns out to be. Classifying first keeps the
 * walk below readable: the page's meaning lives in cell classes, not nesting,
 * so every branch here is a pattern match rather than a structural descent.
 */
type ClassifiedRow =
  | { kind: 'skip' }
  | { kind: 'clock'; text: string }
  | { kind: 'metric'; cell: Cell }
  | { kind: 'heading'; opensPapa: boolean }
  | { kind: 'dispatcher'; cells: Cell[] }
  | { kind: 'sectionTitle' }
  | { kind: 'depth'; name: string; depth: number | null };

function classifyRow(cells: Cell[]): ClassifiedRow {
  const first = cells[0];
  if (!first) return { kind: 'skip' };
  const classes = cells.map((cell) => cell.classNames).join(' ');

  // The outer layout row holding the status bar carries no board data.
  if (/\bstatusBar\b/i.test(classes)) return { kind: 'skip' };
  if (/\bclock\b/i.test(classes)) return { kind: 'clock', text: first.text };
  if (/\bcardServices\b/i.test(classes)) return { kind: 'metric', cell: first };

  // "Queue Name | Depth" and "Message Type | Depth" open a new run of rows.
  if (/\bheading(?:Left|Right)\b/i.test(classes)) {
    return { kind: 'heading', opensPapa: /message\s+type/i.test(first.text) };
  }

  // A named cell spanning the full width is a section title (PaPA); a real
  // dispatcher row carries its two date columns alongside the name.
  if (/\bname\b/i.test(first.classNames)) {
    return cells.length >= 3 ? { kind: 'dispatcher', cells } : { kind: 'sectionTitle' };
  }

  // Header rows of the dispatcher table itself are plain <td>s with no classes.
  if (/^(?:Dispatcher|Queue Name|Depth|Message Type)$/i.test(first.text)) return { kind: 'skip' };

  if (cells.length >= 2) {
    return {
      kind: 'depth',
      name: first.text,
      depth: toCount(cells.at(-1)?.text ?? ''),
    };
  }
  return { kind: 'skip' };
}

/**
 * Walks the board top to bottom. Queue rows carry no back-reference to the
 * dispatcher they belong to — they simply follow it — so the walk tracks the
 * most recent heading and attaches subsequent rows to it.
 */
export function parseBoard(html: string): Omit<RadarBoard, 'xcenter'> {
  const dispatchers: RadarDispatcher[] = [];
  const queueRuns: RadarRow[][] = [];
  const metrics: RadarMetric[] = [];
  let papa: RadarRow[] = [];
  let currentTime: string | null = null;
  let collecting: RadarRow[] | null = null;

  for (const rowHtml of rowsOf(withoutXCenterTable(html))) {
    const row = classifyRow(cellsOf(rowHtml));

    switch (row.kind) {
      case 'clock': {
        currentTime = row.text.replace(/^Current Time\s*:\s*/i, '').trim() || null;
        break;
      }
      case 'metric': {
        metrics.push(toMetric(row.cell));
        break;
      }
      case 'heading': {
        collecting = [];
        if (row.opensPapa) papa = collecting;
        else queueRuns.push(collecting);
        break;
      }
      case 'dispatcher': {
        const [name, schedule, pubSub] = row.cells;
        dispatchers.push({
          name: name?.text ?? '',
          tone: toneOf(name?.classNames ?? ''),
          lastScheduleDate: schedule?.text ?? '',
          lastPubSubDate: pubSub?.text ?? '',
          queues: [],
        });
        collecting = null;
        break;
      }
      case 'sectionTitle': {
        collecting = null;
        break;
      }
      case 'depth': {
        if (collecting && row.name && row.depth !== null) {
          collecting.push({ name: row.name, depth: row.depth });
        }
        break;
      }
      default:
        break;
    }
  }

  // Queue runs appear directly after the dispatcher they describe.
  queueRuns.forEach((run, index) => {
    const dispatcher = dispatchers[index];
    if (dispatcher) dispatcher.queues = run;
  });

  return { color: parseStatusColor(html), dispatchers, papa, metrics, currentTime };
}

/**
 * Detects the SSO form coming back in place of the dashboard. An expired
 * session answers 200 with the login page, so this cannot rely on the status
 * code.
 */
export function looksLikeSignInPage(html: string): boolean {
  if (/<input[^>]+type=["']password["']/i.test(html)) return true;
  return /<form[^>]*\b(?:action|id|name)=["'][^"']*log[io]n/i.test(html);
}
