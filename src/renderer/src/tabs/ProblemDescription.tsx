import { Fragment, useId, useState, type ReactNode } from 'react';

/**
 * Dynatrace problem descriptions are Markdown. Relay renders the small subset they use — headings,
 * paragraphs, bullet lists, bold, italics and inline code — as React elements, never as HTML, so a
 * description can format text but cannot inject markup.
 */
type DescriptionBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

type InlineToken = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** The marked-up token that starts at `index`, with the index after it, or null for plain text. */
function markupAt(text: string, index: number): { token: InlineToken; end: number } | null {
  const char = text[index];
  const pair = text.slice(index, index + 2);
  const opensWord = !isWordChar(text[index - 1]) && text[index + 1] !== ' ';
  if ((pair === '**' || pair === '__') && opensWord) {
    const close = text.indexOf(pair, index + 2);
    if (close > index + 2) {
      return { token: { kind: 'strong', text: text.slice(index + 2, close) }, end: close + 2 };
    }
  }
  if (char === '`') {
    const close = text.indexOf('`', index + 1);
    if (close > index + 1) {
      return { token: { kind: 'code', text: text.slice(index + 1, close) }, end: close + 1 };
    }
  }
  if ((char === '*' || char === '_') && opensWord && text[index + 1] !== char) {
    const close = text.indexOf(char, index + 1);
    if (close > index + 1 && !isWordChar(text[close + 1])) {
      return { token: { kind: 'em', text: text.slice(index + 1, close) }, end: close + 1 };
    }
  }
  return null;
}

/**
 * Splits bold (`**`/`__`), italics (`*`/`_`) and inline code (backticks) from plain text with a
 * linear scan. Underscores inside a word (`backup_agent_main`) stay literal, as do unclosed markers.
 */
function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const markup = markupAt(text, index);
    if (markup) {
      if (plain) tokens.push({ kind: 'text', text: plain });
      plain = '';
      tokens.push(markup.token);
      index = markup.end;
    } else {
      plain += text[index];
      index += 1;
    }
  }
  if (plain) tokens.push({ kind: 'text', text: plain });
  return tokens;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** Inline markup removed: for comparing a heading with the problem title. */
function plainText(text: string): string {
  return tokenizeInline(text)
    .map((token) => token.text)
    .join('');
}

/** `# Heading` text (one to six `#` then a space), or undefined. */
function headingText(line: string): string | undefined {
  let level = 0;
  while (line[level] === '#' && level < 7) level += 1;
  return level >= 1 && level <= 6 && line[level] === ' ' ? line.slice(level + 1).trim() : undefined;
}

/** `- item`, `* item` or `+ item` text, or undefined. */
function bulletText(line: string): string | undefined {
  return '-*+'.includes(line[0] ?? '') && line[1] === ' ' ? line.slice(2).trim() : undefined;
}

export function parseProblemDescription(source: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    if (list.length > 0) blocks.push({ kind: 'list', items: list });
    paragraph = [];
    list = [];
  };
  for (const rawLine of source.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = rawLine.trim();
    const heading = headingText(line);
    const bullet = bulletText(line);
    if (!line) {
      flush();
    } else if (heading !== undefined) {
      flush();
      blocks.push({ kind: 'heading', text: heading });
    } else if (bullet !== undefined) {
      if (paragraph.length > 0) flush();
      list.push(bullet);
    } else {
      if (list.length > 0) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${index}-${token.kind}`;
    if (token.kind === 'strong') return <strong key={key}>{token.text}</strong>;
    if (token.kind === 'code') return <code key={key}>{token.text}</code>;
    if (token.kind === 'em') return <em key={key}>{token.text}</em>;
    return <Fragment key={key}>{token.text}</Fragment>;
  });
}

/** True when the description adds something beyond the given titles. */
export function describesMoreThan(source: string, titles: readonly string[]): boolean {
  const known = new Set(titles.map(normalize));
  return parseProblemDescription(source).some(
    (block) =>
      !isStockSentence(block) &&
      (block.kind === 'list' || !known.has(normalize(plainText(block.text)))),
  );
}

/** The description's leading heading when it names the problem, which the caller can then skip. */
export function leadingHeading(source: string): string {
  const first = parseProblemDescription(source)[0];
  return first?.kind === 'heading' ? plainText(first.text) : '';
}

/** Dynatrace's stock sentences, which Root cause and Systems affected already state. */
const STOCK_SENTENCES = [
  /^the problem affects \d+ entit(?:y|ies) overall\.?$/u,
  /^following entities were affected by the problem:?$/u,
];

function isStockSentence(block: DescriptionBlock): boolean {
  if (block.kind !== 'paragraph') return false;
  const text = normalize(plainText(block.text));
  return STOCK_SENTENCES.some((pattern) => pattern.test(text));
}

/** A paragraph that is only bold text (`**Host, web-01**`) opens an entity group. */
function isEntityLabel(text: string): boolean {
  const tokens = tokenizeInline(text.trim());
  return tokens.length === 1 && tokens[0]?.kind === 'strong';
}

/** Blocks shown before Show full description; a longer description starts collapsed. */
const COLLAPSED_BLOCK_COUNT = 3;

function DescriptionBlockView({ block }: Readonly<{ block: DescriptionBlock }>) {
  if (block.kind === 'heading') {
    return <h5 className="dt-problem-detail__workflow-heading">{renderInline(block.text)}</h5>;
  }
  if (block.kind === 'list') {
    return (
      <ul>
        {block.items.map((item, itemIndex) => (
          <li key={`${itemIndex}-${item}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  if (isEntityLabel(block.text)) {
    return <p className="dt-problem-detail__workflow-entity">{plainText(block.text)}</p>;
  }
  return <p>{renderInline(block.text)}</p>;
}

export function ProblemDescription({
  source,
  omitTitles = [],
}: Readonly<{ source: string; omitTitles?: readonly string[] }>) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const omit = new Set(omitTitles.map(normalize));
  const blocks = parseProblemDescription(source).filter(
    (block) =>
      !isStockSentence(block) &&
      (block.kind !== 'heading' || !omit.has(normalize(plainText(block.text)))),
  );
  const collapsible = blocks.length > COLLAPSED_BLOCK_COUNT + 1;
  const shown = collapsible && !expanded ? blocks.slice(0, COLLAPSED_BLOCK_COUNT) : blocks;
  return (
    <div className="dt-problem-detail__workflow-description">
      <div id={contentId} className="dt-problem-detail__workflow-blocks">
        {shown.map((block, index) => (
          <DescriptionBlockView key={`${block.kind}-${index}`} block={block} />
        ))}
      </div>
      {collapsible && (
        <button
          type="button"
          className="dt-problem-detail__description-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Show full description'}
        </button>
      )}
    </div>
  );
}
