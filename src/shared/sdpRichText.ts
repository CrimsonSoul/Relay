/**
 * Relay's reply markup: the formatting a reply editor can express, carried as text. The server
 * renders it into SDP's message HTML, escaping every character the person typed and adding only
 * these tags, so operator input never reaches SDP as raw HTML.
 *
 * - `**bold**`, `*italic*`, `__underline__` and `[label](https://…)` (http, https or mailto)
 * - a line starting `- ` is a bullet, `1. ` a numbered item, and `> ` a quoted line
 * - a backslash makes the next punctuation character literal
 */

type Mark = 'b' | 'i' | 'u';
const TAGS: Record<Mark, readonly [string, string]> = {
  b: ['<strong>', '</strong>'],
  i: ['<em>', '</em>'],
  u: ['<u>', '</u>'],
};
const QUOTE_STYLE = 'margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex';
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(((?:https?:\/\/|mailto:)[^\s()<>"'\\]+)\)/;
const ESCAPED = /[!-/:-@[-`{-~]/;
const QUOTE_LINE = /^>(?: |$)/;
const BULLET_LINE = /^- /;
const NUMBER_LINE = /^(\d{1,9})\. /;

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** One line's inline markup being read: the output so far and the marks still open. */
class InlineReader {
  out = '';
  private readonly open: Mark[] = [];
  constructor(private readonly plain: boolean) {}
  text(value: string) {
    this.out += this.plain ? value : escapeHtml(value);
  }
  toggle(mark: Mark) {
    if (this.plain) return;
    const at = this.open.lastIndexOf(mark);
    if (at < 0) {
      this.open.push(mark);
      this.out += TAGS[mark][0];
      return;
    }
    // Closing a mark that is not innermost closes and reopens the marks inside it.
    const above = this.open.splice(at);
    for (const m of above.toReversed()) this.out += TAGS[m][1];
    for (const m of above.slice(1)) this.out += TAGS[m][0];
    this.open.push(...above.slice(1));
  }
  link(label: string, href: string) {
    const text = inline(label, this.plain);
    if (this.plain) this.out += `${text} (${href})`;
    else this.out += `<a href="${escapeHtml(href)}">${text || escapeHtml(href)}</a>`;
  }
  finish(): string {
    for (const m of this.open.toReversed()) this.out += TAGS[m][1];
    return this.out;
  }
}

/** Reads the token at `i` into `reader`, returning where the next token starts. */
function readToken(text: string, i: number, reader: InlineReader): number {
  const char = text.charAt(i);
  const next = text.charAt(i + 1);
  if (char === '\\' && ESCAPED.test(next)) {
    reader.text(next);
    return i + 2;
  }
  if ((char === '*' || char === '_') && next === char) {
    reader.toggle(char === '*' ? 'b' : 'u');
    return i + 2;
  }
  if (char === '*') {
    reader.toggle('i');
    return i + 1;
  }
  const link = char === '[' ? LINK.exec(text.slice(i)) : null;
  if (link) {
    const [whole = '', label = '', href = ''] = link;
    reader.link(label, href);
    return i + whole.length;
  }
  reader.text(char);
  return i + 1;
}

/** One line's inline markup as HTML, or as plain text with links spelled out. */
function inline(text: string, plain: boolean): string {
  const reader = new InlineReader(plain);
  for (let i = 0; i < text.length;) i = readToken(text, i, reader);
  return reader.finish();
}

/** Consecutive lines matching `test`, from `start`. */
function run(lines: readonly string[], start: number, test: RegExp): string[] {
  let end = start;
  while (end < lines.length && test.test(lines[end] ?? '')) end++;
  return lines.slice(start, end);
}

type Part = { text: boolean; html: string; lines: number };
/** The block that starts at `lines[i]`: a quote, list or one line of text. */
function blockAt(lines: readonly string[], i: number, editing: boolean): Part {
  const line = lines[i] ?? '';
  if (QUOTE_LINE.test(line)) {
    const group = run(lines, i, QUOTE_LINE);
    const inner = blocks(
      group.map((l) => l.replace(QUOTE_LINE, '')),
      editing,
    );
    // Mail clients show a quote by its own style; an editor styles it with the page.
    const style = editing ? '' : ` style="${QUOTE_STYLE}"`;
    return { text: false, html: `<blockquote${style}>${inner}</blockquote>`, lines: group.length };
  }
  if (BULLET_LINE.test(line)) {
    const group = run(lines, i, BULLET_LINE);
    const items = group.map((l) => `<li>${inline(l.slice(2), false)}</li>`).join('');
    return { text: false, html: `<ul>${items}</ul>`, lines: group.length };
  }
  if (NUMBER_LINE.test(line)) {
    const group = run(lines, i, NUMBER_LINE);
    const first = Number(NUMBER_LINE.exec(line)?.[1]);
    const items = group.map((l) => `<li>${inline(l.replace(NUMBER_LINE, ''), false)}</li>`);
    const start = first === 1 ? '' : ' start="' + first + '"';
    return { text: false, html: `<ol${start}>${items.join('')}</ol>`, lines: group.length };
  }
  return { text: true, html: inline(line, false), lines: 1 };
}

function blocks(lines: readonly string[], editing: boolean): string {
  const parts: Part[] = [];
  for (let i = 0; i < lines.length; i += parts.at(-1)!.lines)
    parts.push(blockAt(lines, i, editing));
  // An editor holds each line in its own block, as browsers edit them.
  if (editing)
    return parts
      .map((part) => (part.text ? `<div>${part.html || '<br>'}</div>` : part.html))
      .join('');
  // Text lines break like plain text does; lists and quotes are blocks of their own.
  return parts
    .map((part, index) => (part.text && parts[index - 1]?.text ? `<br>${part.html}` : part.html))
    .join('');
}

/** Reply markup as the HTML SDP stores for a message. */
export function sdpRichHtml(markup: string): string {
  return blocks(markup.split(/\r?\n/), false);
}

/** Reply markup as editable HTML: the same formatting, with one block per line. */
export function sdpRichEditorHtml(markup: string): string {
  return blocks(markup.split(/\r?\n/), true);
}

/** Reply markup as readable plain text, for a server that predates the markup. */
export function sdpRichPlain(markup: string): string {
  return markup
    .split(/\r?\n/)
    .map((line) => {
      const [, prefix = '', rest = ''] = /^((?:>(?: |$))*(?:- |\d{1,9}\. )?)(.*)$/.exec(line) ?? [];
      return prefix + inline(rest, true);
    })
    .join('\n');
}

/** Text as markup that reads back as exactly that text, line markers included. */
export function sdpRichEscape(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replaceAll(/[\\*_[\]]/g, String.raw`\$&`)
        .replace(/^(?:- |>(?: |$))/, String.raw`\$&`)
        .replace(/^(\d{1,9})\. /, String.raw`$1\. `),
    )
    .join('\n');
}
