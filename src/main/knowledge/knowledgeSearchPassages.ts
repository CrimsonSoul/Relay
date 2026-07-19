import type { KnowledgeOutlineNode } from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT,
  normalizeKnowledgeSearchTextWithRanges,
} from '@shared/knowledgeSearch';
import type { KnowledgeSearchExtractedPage } from './knowledgeSearchExtraction';

const TARGET_PASSAGE_LENGTH = 900;
const PASSAGE_OVERLAP = 120;

export type KnowledgeSearchPassage = {
  pageNumber: number;
  passageNumber: number;
  headingId: string | null;
  heading: string | null;
  text: string;
  normalizedText: string;
  normalizedStart: number;
  normalizedEnd: number;
};

function headingForPage(
  outline: readonly KnowledgeOutlineNode[],
  pageIndex: number,
): Pick<KnowledgeSearchPassage, 'headingId' | 'heading'> {
  let headingId: string | null = null;
  let heading: string | null = null;
  for (const node of outline) {
    if (node.pageIndex > pageIndex) continue;
    headingId = node.id;
    heading = node.label;
  }
  return { headingId, heading };
}

function wordBoundaries(text: string): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  const segmenter = new Intl.Segmenter('en-US', { granularity: 'word' });
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    starts.push(segment.index);
    ends.push(segment.index + segment.segment.length);
  }
  return { starts, ends };
}

function lastAtOrBefore(
  boundaries: readonly number[],
  maximum: number,
  minimum: number,
): number | null {
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index];
    if (boundary <= maximum && boundary > minimum) return boundary;
  }
  return null;
}

function boundedEnd({
  start,
  text,
  ends,
  sourceRanges,
}: {
  start: number;
  text: string;
  ends: readonly number[];
  sourceRanges: ReturnType<typeof normalizeKnowledgeSearchTextWithRanges>['sourceRanges'];
}): number {
  const rawStart = sourceRanges[start]?.start ?? 0;
  const preferred = Math.min(text.length, start + TARGET_PASSAGE_LENGTH);
  const maximum = Math.min(text.length, start + KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT);
  const candidates = [lastAtOrBefore(ends, preferred, start), lastAtOrBefore(ends, maximum, start)];
  for (const candidate of candidates) {
    if (
      candidate !== null &&
      (sourceRanges[candidate - 1]?.end ?? Number.POSITIVE_INFINITY) - rawStart <=
        KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT
    ) {
      return candidate;
    }
  }

  let end = maximum;
  while (
    end > start + 1 &&
    (sourceRanges[end - 1]?.end ?? Number.POSITIVE_INFINITY) - rawStart >
      KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT
  ) {
    end -= 1;
  }
  return Math.max(start + 1, end);
}

function nextStart({
  start,
  end,
  starts,
}: {
  start: number;
  end: number;
  starts: readonly number[];
}): number {
  const overlapStart = Math.max(start + 1, end - PASSAGE_OVERLAP);
  return lastAtOrBefore(starts, overlapStart, start) ?? overlapStart;
}

export function buildKnowledgeSearchPassages(
  pages: readonly KnowledgeSearchExtractedPage[],
  outline: readonly KnowledgeOutlineNode[],
): KnowledgeSearchPassage[] {
  const passages: KnowledgeSearchPassage[] = [];

  for (const page of pages) {
    const rawText = page.items.map((item) => `${item.str}${item.hasEOL ? ' ' : ''}`).join('');
    const normalized = normalizeKnowledgeSearchTextWithRanges(rawText);
    if (!normalized.text) continue;

    const { starts, ends } = wordBoundaries(normalized.text);
    const section = headingForPage(outline, page.pageNumber - 1);
    let normalizedStart = 0;
    let passageNumber = 1;
    while (normalizedStart < normalized.text.length) {
      const normalizedEnd = boundedEnd({
        start: normalizedStart,
        text: normalized.text,
        ends,
        sourceRanges: normalized.sourceRanges,
      });
      const rawStart = normalized.sourceRanges[normalizedStart]?.start;
      const rawEnd = normalized.sourceRanges[normalizedEnd - 1]?.end;
      if (rawStart === undefined || rawEnd === undefined || normalizedEnd <= normalizedStart) break;

      passages.push({
        pageNumber: page.pageNumber,
        passageNumber,
        ...section,
        text: rawText.slice(rawStart, rawEnd),
        normalizedText: normalized.text.slice(normalizedStart, normalizedEnd),
        normalizedStart,
        normalizedEnd,
      });
      if (normalizedEnd >= normalized.text.length) break;
      normalizedStart = nextStart({ start: normalizedStart, end: normalizedEnd, starts });
      passageNumber += 1;
    }
  }

  return passages;
}
