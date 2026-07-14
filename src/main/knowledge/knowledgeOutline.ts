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

function normalizeNativeLabel(value: string): string | null {
  const label = value.trim().replace(/\s+/g, ' ');
  return label.length > 0 && label.length <= KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH ? label : null;
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

  return groups.map((items) => {
    const ordered = items.toSorted(
      (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
    );
    return {
      text: ordered
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' '),
      pageIndex: page.pageIndex,
      top: ordered[0]?.transform[5] ?? 0,
      fontSize: Math.max(...ordered.map(itemFontSize)),
      bold: ordered.some((item) => /bold|black|heavy|semibold/i.test(item.fontName)),
      pageHeight: page.height,
    };
  });
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

function isHeadingCandidate(line: KnowledgeTextLine, bodySize: number): boolean {
  const label = line.text.trim();
  if (label.length < 3 || label.length > KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH) return false;
  if (isPageNumber(label) || label.split(/\s+/).length > 20) return false;
  return line.fontSize >= bodySize * 1.2 || (line.bold && line.fontSize >= bodySize * 1.05);
}

export function inferKnowledgeOutline(pages: KnowledgeTextPage[]): KnowledgeOutlineNode[] {
  const lines = pages.flatMap(groupPageLines);
  if (lines.length === 0) return [];

  const repeatedMargins = repeatedMarginLabels(lines, pages.length);
  const usableLines = lines.filter(
    (line) =>
      !repeatedMargins.has(normalizeKnowledgeSearchText(line.text)) && !isPageNumber(line.text),
  );
  const bodySize = predominantBodySize(usableLines);
  if (bodySize <= 0) return [];

  const candidates = usableLines.filter((line) => isHeadingCandidate(line, bodySize));
  const candidateSizes = [...new Set(candidates.map((line) => line.fontSize))].toSorted(
    (left, right) => right - left,
  );
  const largestSize = candidateSizes[0];

  return candidates.slice(0, KNOWLEDGE_MAX_OUTLINE_NODES).map((line, index) => ({
    id: stableNodeId(`${index}|${line.text}|${line.pageIndex}|${line.top}`),
    label: line.text,
    level: line.fontSize === largestSize ? 1 : 2,
    pageIndex: line.pageIndex,
    top: line.top,
  }));
}
