import {
  KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH,
  KNOWLEDGE_MAX_OUTLINE_NODES,
  normalizeKnowledgeSearchText,
  type KnowledgeOutlineNode,
} from '@shared/knowledge';

export type NativeKnowledgeOutlineEntry = {
  title: string;
  dest: string | unknown[] | null;
  items: NativeKnowledgeOutlineEntry[];
};

export type KnowledgeDestination = { pageIndex: number; top: number | null };

export type KnowledgeTextItem = {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
};

export type KnowledgeTextPage = {
  pageIndex: number;
  height: number;
  items: KnowledgeTextItem[];
};

type NativeOutlineContext = {
  nodes: KnowledgeOutlineNode[];
  resolveDestination: (
    destination: NativeKnowledgeOutlineEntry['dest'],
  ) => Promise<KnowledgeDestination | null>;
};

type KnowledgeTextLine = {
  text: string;
  pageIndex: number;
  top: number;
  fontSize: number;
  bold: boolean;
  pageHeight: number;
  items: KnowledgeTextItem[];
  gapAbove: number;
  gapBelow: number;
};

function stableNodeId(seed: string): string {
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `heading-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function validDestination(
  destination: KnowledgeDestination | null,
): destination is KnowledgeDestination {
  return (
    destination !== null &&
    Number.isInteger(destination.pageIndex) &&
    destination.pageIndex >= 0 &&
    (destination.top === null || (Number.isFinite(destination.top) && destination.top >= 0))
  );
}

function inferredDestinationTop(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isContentsHeading(value: string): boolean {
  return /^(?:table of )?contents:?$/i.test(value.trim());
}

function normalizeNativeLabel(value: string): string | null {
  const label = value.trim().replace(/\s+/g, ' ');
  return label.length > 0 &&
    label.length <= KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH &&
    !isContentsHeading(label)
    ? label
    : null;
}

async function visitNativeEntries(
  entries: NativeKnowledgeOutlineEntry[],
  depth: number,
  path: string,
  context: NativeOutlineContext,
): Promise<void> {
  const siblingDestinations = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    if (context.nodes.length >= KNOWLEDGE_MAX_OUTLINE_NODES) return;
    const entry = entries[index];
    if (!entry) continue;
    const accepted = await appendNativeEntry(
      entry,
      index,
      depth,
      path,
      siblingDestinations,
      context,
    );

    if (entry.items.length > 0) {
      await visitNativeEntries(
        entry.items,
        accepted ? depth + 1 : depth,
        `${path}.${index}`,
        context,
      );
    }
  }
}

async function appendNativeEntry(
  entry: NativeKnowledgeOutlineEntry,
  index: number,
  depth: number,
  path: string,
  siblingDestinations: Set<string>,
  context: NativeOutlineContext,
): Promise<boolean> {
  const label = normalizeNativeLabel(entry.title);
  const destination = entry.dest === null ? null : await context.resolveDestination(entry.dest);
  if (label === null || !validDestination(destination)) return false;

  const dedupeKey = `${normalizeKnowledgeSearchText(label)}|${destination.pageIndex}|${destination.top ?? ''}`;
  if (siblingDestinations.has(dedupeKey)) return true;

  siblingDestinations.add(dedupeKey);
  const nodePath = `${path}.${index}`;
  context.nodes.push({
    id: stableNodeId(`${nodePath}|${label}|${destination.pageIndex}|${destination.top ?? 'page'}`),
    label,
    level: depth <= 1 ? 1 : 2,
    pageIndex: destination.pageIndex,
    top: destination.top,
  });
  return true;
}

export async function normalizeNativeKnowledgeOutline(
  outline: NativeKnowledgeOutlineEntry[],
  resolveDestination: (
    destination: NativeKnowledgeOutlineEntry['dest'],
  ) => Promise<KnowledgeDestination | null>,
): Promise<KnowledgeOutlineNode[]> {
  const nodes: KnowledgeOutlineNode[] = [];
  await visitNativeEntries(outline, 1, 'root', { nodes, resolveDestination });
  return nodes;
}

function itemFontSize(item: KnowledgeTextItem): number {
  const verticalScale = Math.abs(item.transform[3] ?? 0);
  const horizontalScale = Math.abs(item.transform[0] ?? 0);
  return Math.max(verticalScale, horizontalScale);
}

function joinLineItems(items: KnowledgeTextItem[]): string {
  let text = '';
  let previous: KnowledgeTextItem | null = null;

  for (const item of items) {
    const value = item.str.trim().replace(/\s+/g, ' ');
    if (!value) continue;

    if (previous === null) {
      text = value;
      previous = item;
      continue;
    }

    const previousRight = (previous.transform[4] ?? 0) + previous.width;
    const gap = (item.transform[4] ?? 0) - previousRight;
    const referenceSize = Math.min(itemFontSize(previous), itemFontSize(item));
    const hasExplicitSpace = /\s$/.test(previous.str) || /^\s/.test(item.str);
    const hasVisualWordGap = referenceSize > 0 && gap > referenceSize * 0.12;
    text += `${hasExplicitSpace || hasVisualWordGap ? ' ' : ''}${value}`;
    previous = item;
  }

  return text;
}

function groupPageLines(page: KnowledgeTextPage): KnowledgeTextLine[] {
  const sorted = page.items
    .filter((item) => item.str.trim() && item.transform.length >= 6)
    .toSorted((left, right) => {
      const vertical = (right.transform[5] ?? 0) - (left.transform[5] ?? 0);
      return Math.abs(vertical) > 2
        ? vertical
        : (left.transform[4] ?? 0) - (right.transform[4] ?? 0);
    });
  const groups: KnowledgeTextItem[][] = [];

  for (const item of sorted) {
    const baseline = item.transform[5] ?? 0;
    const current = groups.at(-1);
    const currentBaseline = current?.[0]?.transform[5] ?? Number.POSITIVE_INFINITY;
    if (!current || Math.abs(currentBaseline - baseline) > 2) groups.push([item]);
    else current.push(item);
  }

  const lines = groups.map((items) => {
    const ordered = items.toSorted(
      (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
    );
    return {
      text: joinLineItems(ordered),
      pageIndex: page.pageIndex,
      top: ordered[0]?.transform[5] ?? 0,
      fontSize: Math.max(...ordered.map(itemFontSize)),
      bold: ordered.some((item) => /bold|black|heavy|semibold/i.test(item.fontName)),
      pageHeight: page.height,
      items: ordered,
      gapAbove: 0,
      gapBelow: 0,
    };
  });

  return lines.map((line, index) => ({
    ...line,
    gapAbove: index > 0 ? Math.max(0, (lines[index - 1]?.top ?? line.top) - line.top) : 0,
    gapBelow:
      index < lines.length - 1 ? Math.max(0, line.top - (lines[index + 1]?.top ?? line.top)) : 0,
  }));
}

type KnowledgeContentsRow = {
  label: string;
  pageIndex: number;
};

function adjacentWrappedLines(upper: KnowledgeTextLine, lower: KnowledgeTextLine): boolean {
  const verticalGap = upper.top - lower.top;
  return (
    Math.abs(upper.fontSize - lower.fontSize) <= 2 &&
    verticalGap > 0 &&
    verticalGap <= Math.max(upper.fontSize, lower.fontSize) * 2
  );
}

function wrappedLinesMatchLabel(
  lines: KnowledgeTextLine[],
  start: number,
  normalizedLabel: string,
): boolean {
  let combined = '';
  for (let offset = 0; offset < 3; offset += 1) {
    const line = lines[start + offset];
    if (!line) return false;
    const previous = offset > 0 ? lines[start + offset - 1] : null;
    if (previous && !adjacentWrappedLines(previous, line)) return false;

    const label = normalizeNativeLabel(`${combined} ${line.text}`);
    if (!label) return false;
    combined = label;
    const normalizedCombined = normalizeKnowledgeSearchText(combined);
    if (normalizedCombined === normalizedLabel) return true;
    if (normalizedCombined.length >= normalizedLabel.length) return false;
  }
  return false;
}

function matchingContentsTarget(
  lines: KnowledgeTextLine[],
  row: KnowledgeContentsRow,
): KnowledgeTextLine | undefined {
  const normalizedLabel = normalizeKnowledgeSearchText(row.label);
  const targetLines = lines
    .filter((line) => line.pageIndex === row.pageIndex)
    .toSorted((left, right) => right.top - left.top);

  for (let start = 0; start < targetLines.length; start += 1) {
    const first = targetLines[start];
    if (first && wrappedLinesMatchLabel(targetLines, start, normalizedLabel)) return first;
  }

  return undefined;
}

function splitContentsRow(text: string): { label: string; pageNumber: number } | null {
  let destinationStart = text.length;
  while (
    destinationStart > 0 &&
    text.length - destinationStart < 4 &&
    text[destinationStart - 1] !== undefined &&
    text[destinationStart - 1]! >= '0' &&
    text[destinationStart - 1]! <= '9'
  ) {
    destinationStart -= 1;
  }
  if (
    destinationStart === text.length ||
    (destinationStart > 0 &&
      text[destinationStart - 1] !== undefined &&
      text[destinationStart - 1]! >= '0' &&
      text[destinationStart - 1]! <= '9')
  ) {
    return null;
  }

  const beforeDestination = text.slice(0, destinationStart).trimEnd();
  let leaderStart = beforeDestination.length;
  let dotCount = 0;
  while (leaderStart > 0) {
    const character = beforeDestination[leaderStart - 1];
    if (character === '.') {
      dotCount += 1;
      leaderStart -= 1;
    } else if (character !== undefined && /\s/.test(character) && dotCount > 0) {
      leaderStart -= 1;
    } else {
      break;
    }
  }
  if (dotCount < 3) return null;

  return {
    label: beforeDestination.slice(0, leaderStart).trim(),
    pageNumber: Number(text.slice(destinationStart)),
  };
}

function parseContentsRow(line: KnowledgeTextLine, pageCount: number): KnowledgeContentsRow | null {
  const items = line.items.filter((item) => item.str.trim());
  const row = splitContentsRow(joinLineItems(items).trim());
  if (!row) return null;

  const { label, pageNumber } = row;
  if (
    pageNumber < 1 ||
    pageNumber > pageCount ||
    isContentsHeading(label) ||
    label.length < 2 ||
    label.length > KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH ||
    label.split(/\s+/).length > 20
  ) {
    return null;
  }

  return { label, pageIndex: pageNumber - 1 };
}

function inferContentsOutline(
  lines: KnowledgeTextLine[],
  pageCount: number,
): KnowledgeOutlineNode[] {
  const contentsHeadings = lines.filter((line) => isContentsHeading(line.text));

  for (const heading of contentsHeadings) {
    const pageLines = lines
      .filter((line) => line.pageIndex === heading.pageIndex && line.top < heading.top)
      .toSorted((left, right) => right.top - left.top);
    const rows = pageLines
      .map((line, index) => {
        const row = parseContentsRow(line, pageCount);
        if (!row) return null;
        let followingLine = line;
        const precedingLabels: string[] = [];
        let bestCombined: KnowledgeContentsRow | null = null;

        for (let offset = 1; offset <= 2; offset += 1) {
          const preceding = pageLines[index - offset];
          if (!preceding || parseContentsRow(preceding, pageCount)) break;
          const verticalGap = preceding.top - followingLine.top;
          const similarFontSize = Math.abs(preceding.fontSize - followingLine.fontSize) <= 2;
          const closeEnough =
            verticalGap > 0 &&
            verticalGap <= Math.max(preceding.fontSize, followingLine.fontSize) * 2;
          const precedingLabel = normalizeNativeLabel(preceding.text);
          if (!similarFontSize || !closeEnough || !precedingLabel) break;
          precedingLabels.unshift(precedingLabel);
          const combinedLabel = normalizeNativeLabel(`${precedingLabels.join(' ')} ${row.label}`);
          if (!combinedLabel) break;
          const combined = { ...row, label: combinedLabel };
          if (matchingContentsTarget(lines, combined)) bestCombined = combined;
          followingLine = preceding;
        }

        return bestCombined ?? row;
      })
      .filter((row): row is KnowledgeContentsRow => row !== null);
    if (rows.length < 2) continue;
    if (
      rows.some((row) => row.pageIndex < heading.pageIndex) ||
      rows.some((row, index) => index > 0 && row.pageIndex < (rows[index - 1]?.pageIndex ?? 0))
    ) {
      continue;
    }

    return rows.slice(0, KNOWLEDGE_MAX_OUTLINE_NODES).map((row, index) => {
      const target = matchingContentsTarget(lines, row);
      const top = target ? inferredDestinationTop(target.top) : null;
      return {
        id: stableNodeId(`contents|${index}|${row.label}|${row.pageIndex}|${top ?? 'page'}`),
        label: row.label,
        level: 1,
        pageIndex: row.pageIndex,
        top,
      };
    });
  }

  return [];
}

function repeatedMarginLabels(lines: KnowledgeTextLine[], pageCount: number): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  for (const line of lines) {
    const isMargin = line.top >= line.pageHeight * 0.9 || line.top <= line.pageHeight * 0.1;
    if (!isMargin) continue;
    const key = normalizeKnowledgeSearchText(line.text);
    if (!key) continue;
    const pages = occurrences.get(key) ?? new Set<number>();
    pages.add(line.pageIndex);
    occurrences.set(key, pages);
  }

  const minimumPages = Math.max(2, Math.ceil(pageCount * 0.6));
  return new Set(
    [...occurrences.entries()]
      .filter(([, pages]) => pages.size >= minimumPages)
      .map(([label]) => label),
  );
}

function isPageNumber(text: string): boolean {
  return /^(?:page\s+)?\d+(?:\s+of\s+\d+)?$/i.test(text.trim());
}

function predominantBodySize(lines: KnowledgeTextLine[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const bucket = Math.round(line.fontSize * 2) / 2;
    weights.set(bucket, (weights.get(bucket) ?? 0) + Math.min(line.text.length, 120));
  }
  return [...weights.entries()].reduce(
    (best, current) => (current[1] > best[1] ? current : best),
    [0, 0],
  )[0];
}

function isCoverLikePage(lines: KnowledgeTextLine[], bodySize: number): boolean {
  const prominentLines = lines.filter((line) => line.fontSize >= bodySize * 1.5);
  const prominentSizes = new Set(prominentLines.map((line) => Math.round(line.fontSize * 2) / 2));
  const maximumSize = Math.max(0, ...prominentLines.map((line) => line.fontSize));
  const bodyProseLines = lines.filter(
    (line) => line.fontSize <= bodySize * 1.1 && line.text.split(/\s+/).length >= 6,
  );

  return (
    prominentLines.length >= 3 &&
    prominentSizes.size >= 2 &&
    maximumSize >= bodySize * 2.5 &&
    bodyProseLines.length <= 2
  );
}

function isHeadingCandidate(line: KnowledgeTextLine, bodySize: number): boolean {
  const label = line.text.trim();
  if (label.length < 3 || label.length > KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH) return false;
  if (isPageNumber(label) || label.split(/\s+/).length > 20) return false;

  if (line.fontSize >= bodySize * 1.5) return true;
  const meaningfullyLarger = line.fontSize >= bodySize * 1.2;
  const borderlineBold = line.bold && line.fontSize >= bodySize * 1.05;
  if (!meaningfullyLarger && !borderlineBold) return false;

  const isolationThreshold = Math.max(line.fontSize * 1.8, bodySize * 2.4);
  return line.gapAbove >= isolationThreshold || line.gapBelow >= isolationThreshold;
}

export function inferKnowledgeOutline(pages: KnowledgeTextPage[]): KnowledgeOutlineNode[] {
  const lines = pages.flatMap(groupPageLines);
  if (lines.length === 0) return [];

  const pageCount = Math.max(pages.length, ...pages.map((page) => page.pageIndex + 1));
  const contentsOutline = inferContentsOutline(lines, pageCount);
  if (contentsOutline.length > 0) return contentsOutline;

  const repeatedMargins = repeatedMarginLabels(lines, pages.length);
  const usableLines = lines.filter(
    (line) =>
      !isContentsHeading(line.text) &&
      !repeatedMargins.has(normalizeKnowledgeSearchText(line.text)) &&
      !isPageNumber(line.text),
  );
  const bodySize = predominantBodySize(usableLines);
  if (bodySize <= 0) return [];

  const firstPageIndex = Math.min(...pages.map((page) => page.pageIndex));
  const firstPageLines = usableLines.filter((line) => line.pageIndex === firstPageIndex);
  const inferenceLines =
    pages.length > 1 && isCoverLikePage(firstPageLines, bodySize)
      ? usableLines.filter((line) => line.pageIndex !== firstPageIndex)
      : usableLines;
  const candidates = inferenceLines.filter((line) => isHeadingCandidate(line, bodySize));
  const candidateSizes = [...new Set(candidates.map((line) => line.fontSize))].toSorted(
    (left, right) => right - left,
  );
  const largestSize = candidateSizes[0];

  return candidates.slice(0, KNOWLEDGE_MAX_OUTLINE_NODES).map((line, index) => {
    const top = inferredDestinationTop(line.top);
    return {
      id: stableNodeId(`${index}|${line.text}|${line.pageIndex}|${top ?? 'page'}`),
      label: line.text,
      level: line.fontSize === largestSize ? 1 : 2,
      pageIndex: line.pageIndex,
      top,
    };
  });
}
