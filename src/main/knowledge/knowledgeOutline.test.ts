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

function contentsRow(label: string, pageNumber: number, y: number) {
  return [
    textItem(label, 60, y, 12),
    textItem('................................', 330, y, 12),
    textItem('................................', 403, y, 12),
    textItem(String(pageNumber), 550, y, 12),
  ];
}

describe('inferKnowledgeOutline', () => {
  it('prefers a credible Contents page over cover text and typography candidates', () => {
    const sections = [
      ['Purpose, Scope, and Responsibilities', 3],
      ['Understanding Oracle Terms and Tickets', 4],
      ['Different Oracle Tickets Explained', 5],
      ['How to Open and Set Up Oracle', 8],
      ['Completing Oracle “Add” Request Tickets', 14],
    ] as const;
    const pages: KnowledgeTextPage[] = Array.from({ length: 14 }, (_, pageIndex) => ({
      pageIndex,
      height: 800,
      items: [],
    }));
    pages[0]?.items.push(
      textItem('Camping World NOC Team', 60, 650, 22, 'Cover-Bold'),
      textItem('SOP Manuals', 60, 600, 36),
      textItem('Oracle', 60, 520, 48, 'Cover-Bold'),
      textItem('Standard operating procedures and step-by-step', 60, 260, 18, 'Cover-Bold'),
      textItem('Maintained by the operations team', 60, 180, 12),
    );
    pages[1]?.items.push(textItem('Contents', 60, 700, 16, 'Heading-Bold'));
    sections.forEach(([label, pageNumber], index) => {
      pages[1]?.items.push(...contentsRow(label, pageNumber, 650 - index * 24));
      pages[pageNumber - 1]?.items.push(
        textItem(label, 60, 700, 20, 'Heading-Bold'),
        textItem(
          `This paragraph contains the ordinary operating details for section ${pageNumber}.`,
          60,
          650,
          10,
        ),
      );
    });

    expect(
      inferKnowledgeOutline(pages).map(({ label, level, pageIndex, top }) => ({
        label,
        level,
        page: pageIndex + 1,
        top,
      })),
    ).toEqual(
      sections.map(([label, page]) => ({
        label,
        level: 1,
        page,
        top: 700,
      })),
    );
  });

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

  it('omits a multi-treatment cover when no credible Contents page exists', () => {
    const pages: KnowledgeTextPage[] = [
      {
        pageIndex: 0,
        height: 800,
        items: [
          textItem('Operations Team', 60, 680, 22, 'Cover-Bold'),
          textItem('SOP Manual', 60, 620, 36),
          textItem('Oracle', 60, 520, 48, 'Cover-Bold'),
          textItem('Standard operating procedures', 60, 260, 18, 'Cover-Bold'),
          textItem('Prepared by the operations team', 60, 180, 12),
        ],
      },
      {
        pageIndex: 1,
        height: 800,
        items: [
          textItem('Overview', 60, 700, 20, 'Heading-Bold'),
          textItem(
            'This paragraph explains the ordinary operating procedure and establishes the body size.',
            60,
            650,
            10,
          ),
        ],
      },
      {
        pageIndex: 2,
        height: 800,
        items: [
          textItem('Resolution', 60, 700, 20, 'Heading-Bold'),
          textItem(
            'This paragraph explains the final recovery procedure using the same ordinary body size.',
            60,
            650,
            10,
          ),
        ],
      },
    ];

    expect(inferKnowledgeOutline(pages).map(({ label }) => label)).toEqual([
      'Overview',
      'Resolution',
    ]);
  });

  it('rejects borderline bold body lines that are not visually isolated', () => {
    const result = inferKnowledgeOutline([
      {
        pageIndex: 0,
        height: 800,
        items: [
          textItem(
            'This paragraph introduces the operational sequence with ordinary body text for the procedure.',
            60,
            720,
            10,
          ),
          textItem('Verify the current state before continuing', 60, 700, 11, 'Body-Bold'),
          textItem(
            'This paragraph continues the same sequence immediately after the emphasized body sentence.',
            60,
            680,
            10,
          ),
          textItem('Recovery procedure', 60, 600, 13, 'Heading-Bold'),
          textItem(
            'This paragraph begins the recovery section after a deliberate visual break in the document.',
            60,
            550,
            10,
          ),
        ],
      },
    ]);

    expect(result.map(({ label }) => label)).toEqual(['Recovery procedure']);
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
