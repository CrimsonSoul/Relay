import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_OUTLINE_NODES,
  KNOWLEDGE_MAX_PAGES,
  KNOWLEDGE_MAX_PDF_BYTES,
  compareKnowledgeCategories,
  compareKnowledgeDocuments,
  normalizeKnowledgeDocumentRecord,
  normalizeKnowledgeSearchText,
} from './knowledge';

const validRecord = {
  id: 'record123',
  sourceKey: 'Monitoring & Triage/Runbook.pdf',
  category: 'Monitoring & Triage',
  title: 'Runbook',
  fileName: 'Runbook.pdf',
  pdf: 'runbook.pdf',
  checksum: 'a'.repeat(64),
  byteSize: 1_024,
  pageCount: 3,
  outline: [
    { id: 'intro', label: 'Introduction', level: 1, pageIndex: 0, top: 720 },
    { id: 'check', label: 'Check status', level: 2, pageIndex: 1, top: null },
  ],
  outlineSource: 'native',
  sourceModifiedAt: '2026-07-14T12:00:00.000Z',
  indexedAt: '2026-07-14T12:01:00.000Z',
  created: '2026-07-14T12:01:00.000Z',
  updated: '2026-07-14T12:01:00.000Z',
};

describe('knowledge contracts', () => {
  it('publishes the approved collection and safety limits', () => {
    expect(KNOWLEDGE_DOCUMENTS_COLLECTION).toBe('knowledge_documents');
    expect(KNOWLEDGE_MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
    expect(KNOWLEDGE_MAX_PAGES).toBe(1_000);
    expect(KNOWLEDGE_MAX_OUTLINE_NODES).toBe(500);
  });

  it('normalizes a valid PocketBase record and discards unknown data', () => {
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, ignored: 'value' })).toEqual(
      validRecord,
    );
  });

  it('drops malformed outline nodes without rejecting a readable document', () => {
    const result = normalizeKnowledgeDocumentRecord({
      ...validRecord,
      outline: [
        validRecord.outline[0],
        { id: 'bad-level', label: 'Bad', level: 3, pageIndex: 0, top: 12 },
        { id: 'bad-page', label: 'Bad', level: 1, pageIndex: -1, top: null },
      ],
    });

    expect(result?.outline).toEqual([validRecord.outline[0]]);
  });

  it('rejects a malformed document record', () => {
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, checksum: 'short' })).toBeNull();
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, pageCount: 0 })).toBeNull();
    expect(
      normalizeKnowledgeDocumentRecord({ ...validRecord, outlineSource: 'guessed' }),
    ).toBeNull();
  });

  it('normalizes search text case and diacritics', () => {
    expect(normalizeKnowledgeSearchText('  Résolution ÉTAPES  ')).toBe('resolution etapes');
  });

  it('sorts General before alphabetical categories', () => {
    expect(['Zoo', 'access', 'General', 'Monitoring'].sort(compareKnowledgeCategories)).toEqual([
      'General',
      'access',
      'Monitoring',
      'Zoo',
    ]);
  });

  it('sorts documents case-insensitively by title then filename', () => {
    const records = [
      { ...validRecord, id: '3', title: 'Zulu', fileName: 'z.pdf' },
      { ...validRecord, id: '2', title: 'alpha', fileName: 'b.pdf' },
      { ...validRecord, id: '1', title: 'Alpha', fileName: 'a.pdf' },
    ];

    expect(records.toSorted(compareKnowledgeDocuments).map((record) => record.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});
