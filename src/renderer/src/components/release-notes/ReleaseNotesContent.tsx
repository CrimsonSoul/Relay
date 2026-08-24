import { Fragment, type ReactNode } from 'react';

type ReleaseNotesContentProps = Readonly<{
  body: string;
  className?: string;
}>;

type InlineToken = Readonly<{
  end: number;
  kind: 'code' | 'emphasis' | 'link' | 'strong';
  start: number;
  text: string;
}>;

function delimitedToken(
  value: string,
  start: number,
  marker: string,
  kind: InlineToken['kind'],
): InlineToken | null {
  if (!value.startsWith(marker, start)) return null;
  const contentStart = start + marker.length;
  const closing = value.indexOf(marker, contentStart);
  if (closing <= contentStart) return null;
  return { start, end: closing + marker.length, kind, text: value.slice(contentStart, closing) };
}

function linkToken(value: string, start: number): InlineToken | null {
  if (value[start] !== '[') return null;
  const labelEnd = value.indexOf('](', start + 1);
  if (labelEnd <= start + 1) return null;
  const targetEnd = value.indexOf(')', labelEnd + 2);
  if (targetEnd <= labelEnd + 2) return null;
  return {
    start,
    end: targetEnd + 1,
    kind: 'link',
    text: value.slice(start + 1, labelEnd),
  };
}

function tokenAt(value: string, start: number): InlineToken | null {
  return (
    delimitedToken(value, start, '**', 'strong') ??
    delimitedToken(value, start, '__', 'strong') ??
    delimitedToken(value, start, '`', 'code') ??
    linkToken(value, start) ??
    delimitedToken(value, start, '*', 'emphasis') ??
    delimitedToken(value, start, '_', 'emphasis')
  );
}

function nextInlineToken(value: string, start: number): InlineToken | null {
  for (let index = start; index < value.length; index += 1) {
    const token = tokenAt(value, index);
    if (token) return token;
  }
  return null;
}

function renderInlineToken(token: InlineToken, key: string): ReactNode {
  if (token.kind === 'code') return <code key={key}>{token.text}</code>;
  if (token.kind === 'strong') return <strong key={key}>{token.text}</strong>;
  if (token.kind === 'emphasis') return <em key={key}>{token.text}</em>;
  return <Fragment key={key}>{token.text}</Fragment>;
}

function inlineContent(value: string): ReactNode[] {
  const content: ReactNode[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const token = nextInlineToken(value, cursor);
    if (!token) {
      content.push(<Fragment key={`text-${cursor}`}>{value.slice(cursor)}</Fragment>);
      break;
    }
    if (token.start > cursor) {
      content.push(<Fragment key={`text-${cursor}`}>{value.slice(cursor, token.start)}</Fragment>);
    }
    content.push(renderInlineToken(token, `token-${token.start}`));
    cursor = token.end;
  }
  return content;
}

function headingText(line: string): string | null {
  let markerLength = 0;
  while (markerLength < 6 && line[markerLength] === '#') markerLength += 1;
  if (markerLength === 0 || line[markerLength] !== ' ') return null;
  const text = line.slice(markerLength + 1).trim();
  return text || null;
}

function unorderedItemText(line: string): string | null {
  if (!line.startsWith('- ') && !line.startsWith('* ')) return null;
  const text = line.slice(2).trim();
  return text || null;
}

function orderedItemText(line: string): string | null {
  let digitEnd = 0;
  while (digitEnd < line.length && line[digitEnd]! >= '0' && line[digitEnd]! <= '9') {
    digitEnd += 1;
  }
  if (digitEnd === 0 || line.slice(digitEnd, digitEnd + 2) !== '. ') return null;
  const text = line.slice(digitEnd + 2).trim();
  return text || null;
}

function startsBlock(line: string): boolean {
  return Boolean(headingText(line) || unorderedItemText(line) || orderedItemText(line));
}

function listBlock(
  lines: string[],
  start: number,
  itemText: (line: string) => string | null,
  ordered: boolean,
): Readonly<{ block: ReactNode; nextIndex: number }> {
  const items: ReactNode[] = [];
  let index = start;
  while (index < lines.length) {
    const item = itemText(lines[index]?.trim() ?? '');
    if (!item) break;
    items.push(<li key={`item-${index}`}>{inlineContent(item)}</li>);
    index += 1;
  }
  return {
    block: ordered ? (
      <ol key={`list-${start}`}>{items}</ol>
    ) : (
      <ul key={`list-${start}`}>{items}</ul>
    ),
    nextIndex: index,
  };
}

export function ReleaseNotesContent({ body, className }: ReleaseNotesContentProps) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    if (!line) {
      index += 1;
      continue;
    }

    const heading = headingText(line);
    if (heading) {
      blocks.push(<h4 key={`heading-${index}`}>{inlineContent(heading)}</h4>);
      index += 1;
      continue;
    }

    if (unorderedItemText(line)) {
      const list = listBlock(lines, index, unorderedItemText, false);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    if (orderedItemText(line)) {
      const list = listBlock(lines, index, orderedItemText, true);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index]?.trim() ?? '';
      if (!next || startsBlock(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineContent(paragraph.join(' '))}</p>);
  }

  if (blocks.length === 0) {
    return <p className={className}>No details were included with this release.</p>;
  }
  return <div className={className}>{blocks}</div>;
}
