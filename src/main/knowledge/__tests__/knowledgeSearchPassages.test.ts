import { describe, expect, it } from 'vitest';
import { normalizeKnowledgeSearchText } from '@shared/knowledgeSearch';
import { buildKnowledgeSearchPassages } from '../knowledgeSearchPassages';

describe('buildKnowledgeSearchPassages', () => {
  it('keeps passages page-bounded with stable overlap and offsets', () => {
    const passages = buildKnowledgeSearchPassages(
      [
        { pageNumber: 1, items: [{ str: 'Primary recovery procedure '.repeat(80), hasEOL: true }] },
        { pageNumber: 2, items: [{ str: 'Escalation matrix', hasEOL: false }] },
      ],
      [{ id: 'recovery', label: 'Recovery', level: 1, pageIndex: 0, top: null }],
    );

    expect(passages.length).toBeGreaterThan(2);
    expect(passages.every((passage) => passage.normalizedText.length <= 1_600)).toBe(true);
    expect(passages.filter(({ pageNumber }) => pageNumber === 2)).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        passageNumber: 1,
        heading: 'Recovery',
        normalizedText: 'escalation matrix',
      }),
    ]);
    expect(passages[0]?.normalizedStart).toBe(0);
    expect(passages[1]!.normalizedStart).toBeLessThan(passages[0]!.normalizedEnd);
  });

  it('preserves display casing while sharing compatibility and accent normalization', () => {
    const passages = buildKnowledgeSearchPassages(
      [{ pageNumber: 1, items: [{ str: 'Ｃafe\u0301 OnCall', hasEOL: false }] }],
      [],
    );

    expect(passages).toEqual([
      expect.objectContaining({
        text: 'Ｃafe\u0301 OnCall',
        normalizedText: 'café oncall',
        normalizedStart: 0,
        normalizedEnd: 'café oncall'.length,
      }),
    ]);
  });

  it('keeps expanded compatibility graphemes whole at the maximum passage boundary', () => {
    const source = '\ufb03'.repeat(600);
    const passages = buildKnowledgeSearchPassages(
      [{ pageNumber: 1, items: [{ str: source, hasEOL: false }] }],
      [],
    );

    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.normalizedText.length <= 1_600)).toBe(true);
    expect(
      passages.every(
        (passage) => normalizeKnowledgeSearchText(passage.text) === passage.normalizedText,
      ),
    ).toBe(true);
    expect(
      passages.every(
        ({ normalizedStart, normalizedEnd }) =>
          normalizedStart < normalizedEnd && normalizedStart % 3 === 0 && normalizedEnd % 3 === 0,
      ),
    ).toBe(true);
    expect(passages[0]?.normalizedStart).toBe(0);
    expect(passages.at(-1)?.normalizedEnd).toBe(source.normalize('NFKC').length);
    expect(
      passages.slice(1).every((passage, index) => {
        const previous = passages[index]!;
        return (
          passage.normalizedStart > previous.normalizedStart &&
          passage.normalizedStart <= previous.normalizedEnd &&
          passage.normalizedEnd > previous.normalizedEnd
        );
      }),
    ).toBe(true);
  });
});
