import { describe, expect, it } from 'vitest';
import {
  inferKnowledgeOutline,
  normalizeNativeKnowledgeOutline,
  type KnowledgeTextPage,
  type NativeKnowledgeOutlineEntry,
} from './knowledgeOutline';

describe('normalizeNativeKnowledgeOutline', () => {
  it('preserves order, flattens deep levels, and resolves page destinations', async () => {
    const outline: NativeKnowledgeOutlineEntry[] = [
      {
        title: 'Overview',
        dest: 'overview',
        items: [
          {
            title: 'Checks',
            dest: 'checks',
            items: [{ title: 'Deep check', dest: 'deep', items: [] }],
          },
        ],
      },
      { title: 'Resolution', dest: 'resolution', items: [] },
    ];
    const destinations = new Map([
      ['overview', { pageIndex: 0, top: 700 }],
      ['checks', { pageIndex: 1, top: 640 }],
      ['deep', { pageIndex: 1, top: 500 }],
      ['resolution', { pageIndex: 2, top: null }],
    ]);

    const result = await normalizeNativeKnowledgeOutline(outline, async (dest) =>
      typeof dest === 'string' ? (destinations.get(dest) ?? null) : null,
    );

    expect(
      result.map(({ label, level, pageIndex, top }) => ({ label, level, pageIndex, top })),
    ).toEqual([
      { label: 'Overview', level: 1, pageIndex: 0, top: 700 },
      { label: 'Checks', level: 2, pageIndex: 1, top: 640 },
      { label: 'Deep check', level: 2, pageIndex: 1, top: 500 },
      { label: 'Resolution', level: 1, pageIndex: 2, top: null },
    ]);
  });

  it('deduplicates identical sibling labels and destinations and omits invalid entries', async () => {
    const outline: NativeKnowledgeOutlineEntry[] = [
      { title: 'Checks', dest: 'checks', items: [] },
      { title: ' Checks ', dest: 'checks', items: [] },
      { title: 'External only', dest: null, items: [] },
      { title: 'X'.repeat(241), dest: 'long', items: [] },
    ];

    const first = await normalizeNativeKnowledgeOutline(outline, async (dest) =>
      dest === 'checks' ? { pageIndex: 1, top: 500 } : { pageIndex: 2, top: 400 },
    );
    const second = await normalizeNativeKnowledgeOutline(outline, async (dest) =>
      dest === 'checks' ? { pageIndex: 1, top: 500 } : { pageIndex: 2, top: 400 },
    );

    expect(first).toHaveLength(1);
    expect(first[0]?.label).toBe('Checks');
    expect(first[0]?.id).toBe(second[0]?.id);
  });
});

function textItem(str: string, x: number, y: number, size: number, fontName = 'Body') {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, fontName };
}

describe('inferKnowledgeOutline', () => {
  it('uses horizontal geometry to preserve real spaces without splitting adjacent text runs', () => {
    const splitWord = textItem('Completing Oracle Request Tic', 60, 700, 18, 'Heading-Bold');
    const splitWordEnd = (splitWord.transform[4] ?? 0) + splitWord.width;
    const hyphenPrefix = textItem(
      'Standard operating procedures and step',
      60,
      620,
      18,
      'Heading-Bold',
    );
    const firstHyphenX = (hyphenPrefix.transform[4] ?? 0) + hyphenPrefix.width;
    const firstHyphen = textItem('-', firstHyphenX, 620, 18, 'Heading-Bold');
    const by = textItem('by', firstHyphenX + firstHyphen.width, 620, 18, 'Heading-Bold');
    const secondHyphen = textItem(
      '-',
      firstHyphenX + firstHyphen.width + by.width,
      620,
      18,
      'Heading-Bold',
    );
    const finalStep = textItem(
      'step',
      firstHyphenX + firstHyphen.width + by.width + secondHyphen.width,
      620,
      18,
      'Heading-Bold',
    );
    const spacedPrefix = textItem('Routine', 60, 540, 18, 'Heading-Bold');

    const result = inferKnowledgeOutline([
      {
        pageIndex: 0,
        height: 800,
        items: [
          splitWord,
          textItem('kets', splitWordEnd, 700, 18, 'Heading-Bold'),
          hyphenPrefix,
          firstHyphen,
          by,
          secondHyphen,
          finalStep,
          spacedPrefix,
          textItem(
            'Checks',
            (spacedPrefix.transform[4] ?? 0) + spacedPrefix.width + 6,
            540,
            18,
            'Heading-Bold',
          ),
          textItem(
            'This paragraph supplies enough ordinary body text to establish the predominant font size for the document.',
            60,
            460,
            10,
          ),
        ],
      },
    ]);

    expect(result.map(({ label }) => label)).toEqual([
      'Completing Oracle Request Tickets',
      'Standard operating procedures and step-by-step',
      'Routine Checks',
    ]);
  });

  it('infers two heading levels and removes repeated margins, page numbers, and body lines', () => {
    const pages: KnowledgeTextPage[] = [
      {
        pageIndex: 0,
        height: 800,
        items: [
          textItem('Operations Runbook', 60, 780, 10),
          textItem('Overview', 60, 700, 20, 'Heading-Bold'),
          textItem('This paragraph explains the normal operating procedure.', 60, 660, 10),
          textItem('Checks', 60, 600, 16, 'Heading-Bold'),
          textItem('1', 300, 20, 10),
        ],
      },
      {
        pageIndex: 1,
        height: 800,
        items: [
          textItem('Operations Runbook', 60, 780, 10),
          textItem('Resolution', 60, 700, 20, 'Heading-Bold'),
          textItem('Restart the service only after validating dependencies.', 60, 660, 10),
          textItem('2', 300, 20, 10),
        ],
      },
    ];

    expect(
      inferKnowledgeOutline(pages).map(({ label, level, pageIndex }) => ({
        label,
        level,
        pageIndex,
      })),
    ).toEqual([
      { label: 'Overview', level: 1, pageIndex: 0 },
      { label: 'Checks', level: 2, pageIndex: 0 },
      { label: 'Resolution', level: 1, pageIndex: 1 },
    ]);
  });

  it('returns no fabricated outline for pages without usable text', () => {
    expect(inferKnowledgeOutline([{ pageIndex: 0, height: 800, items: [] }])).toEqual([]);
  });
});
