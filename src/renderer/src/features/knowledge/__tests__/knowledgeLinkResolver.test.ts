import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { describe, expect, it } from 'vitest';
import { resolveKnowledgeLink } from '../knowledgeLinkResolver';

function document(
  id: string,
  sourceKey: string,
  overrides: Partial<KnowledgeDocumentRecord> = {},
): KnowledgeDocumentRecord {
  const fileName = sourceKey.replace(/\\/g, '/').split('/').at(-1) ?? sourceKey;
  return {
    id,
    sourceKey,
    category: sourceKey.replace(/\\/g, '/').split('/').at(0) ?? 'General',
    title: fileName.replace(/\.pdf$/i, ''),
    fileName,
    pdf: fileName,
    checksum: id.padEnd(64, 'a').slice(0, 64),
    byteSize: 1_024,
    pageCount: 5,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:01:00.000Z',
    created: '2026-07-14T12:01:00.000Z',
    updated: '2026-07-14T12:01:00.000Z',
    ...overrides,
  };
}

const currentDocument = document('current', 'Operations/Current.pdf', {
  title: 'Current procedures',
  pageCount: 4,
});

function resolve(
  rawUrl: string,
  documents: readonly KnowledgeDocumentRecord[] = [currentDocument],
) {
  return resolveKnowledgeLink({ rawUrl, currentDocument, documents });
}

describe('resolveKnowledgeLink', () => {
  it('resolves a filename that is unique across categories', () => {
    const target = document('runbook', 'Monitoring & Triage/Runbook.pdf', {
      title: 'Monitoring runbook',
    });

    expect(resolve('Runbook.pdf', [currentDocument, target])).toEqual({
      kind: 'knowledge-document',
      documentId: 'runbook',
      title: 'Monitoring runbook',
      pageIndex: 0,
    });
  });

  it('keeps resolving a unique filename after the indexed file moves categories', () => {
    const moved = document('moved', 'New Category/Moved Guide.pdf');

    expect(resolve('../Old Category/Moved Guide.pdf', [currentDocument, moved])).toEqual({
      kind: 'knowledge-document',
      documentId: 'moved',
      title: 'Moved Guide',
      pageIndex: 0,
    });
  });

  it('uses a relative authored path to disambiguate duplicate filenames', () => {
    const operations = document('operations-guide', 'Operations/Guide.pdf');
    const access = document('access-guide', 'Access/Guide.pdf', { title: 'Access guide' });

    expect(resolve('../Access/Guide.pdf', [currentDocument, operations, access])).toEqual({
      kind: 'knowledge-document',
      documentId: 'access-guide',
      title: 'Access guide',
      pageIndex: 0,
    });
  });

  it('normalizes Windows separators in relative authored paths', () => {
    const operations = document('operations-guide', 'Operations/Guide.pdf');
    const access = document('access-guide', 'Access/Guide.pdf');

    expect(resolve('..\\Access\\Guide.pdf', [currentDocument, operations, access])).toMatchObject({
      kind: 'knowledge-document',
      documentId: 'access-guide',
    });
  });

  it('decodes URL-encoded spaces once before matching filenames', () => {
    const target = document('space', 'Reference/Quick Start.pdf');

    expect(resolve('Quick%20Start.pdf', [currentDocument, target])).toMatchObject({
      kind: 'knowledge-document',
      documentId: 'space',
    });
  });

  it.each(['C:\\Archived\\Runbook.pdf', '/srv/relay/Archived/Runbook.pdf'])(
    'uses only a unique filename from absolute authored path %s',
    (rawUrl) => {
      const target = document('runbook', 'Monitoring/Runbook.pdf');

      expect(resolve(rawUrl, [currentDocument, target])).toMatchObject({
        kind: 'knowledge-document',
        documentId: 'runbook',
      });
    },
  );

  it('uses only the decoded pathname from a file URL', () => {
    const target = document('file-url', 'Reference/Quick Start.pdf');

    expect(
      resolve('file:///old/location/Quick%20Start.pdf#page=2', [currentDocument, target]),
    ).toEqual({
      kind: 'knowledge-document',
      documentId: 'file-url',
      title: 'Quick Start',
      pageIndex: 1,
    });
  });

  it.each([
    ['Guide.pdf#page=3', 2],
    ['Guide.pdf', 0],
    ['Guide.pdf#page=bogus', 0],
    ['Guide.pdf#page=0', 0],
    ['Guide.pdf#page=6', 0],
  ])('validates target page fragment in %s', (rawUrl, pageIndex) => {
    const target = document('guide', 'Reference/Guide.pdf', { pageCount: 5 });

    expect(resolve(rawUrl, [currentDocument, target])).toMatchObject({
      kind: 'knowledge-document',
      documentId: 'guide',
      pageIndex,
    });
  });

  it('ignores query text while preserving the page fragment', () => {
    const target = document('guide', 'Reference/Guide.pdf');

    expect(resolve('Guide.pdf?download=1#page=4', [currentDocument, target])).toMatchObject({
      kind: 'knowledge-document',
      documentId: 'guide',
      pageIndex: 3,
    });
  });

  it.each([
    ['#page=3', 2],
    ['#page=bogus', 0],
    ['#page=0', 0],
    ['#page=5', 0],
  ])('resolves current-document fragment %s without reloading PDF bytes', (rawUrl, pageIndex) => {
    expect(resolve(rawUrl)).toEqual({ kind: 'same-document', pageIndex });
  });

  it('returns same-document when an authored PDF path resolves to the current record', () => {
    expect(resolve('Current.pdf#page=2')).toEqual({ kind: 'same-document', pageIndex: 1 });
  });

  it('preserves absolute HTTP and HTTPS URLs for main-process revalidation', () => {
    expect(resolve('https://Docs.Example.com/runbook?q=relay#page=2')).toEqual({
      kind: 'web',
      url: 'https://Docs.Example.com/runbook?q=relay#page=2',
      hostname: 'docs.example.com',
    });
    expect(resolve('http://example.com:8080/')).toEqual({
      kind: 'web',
      url: 'http://example.com:8080/',
      hostname: 'example.com',
    });
  });

  it('upgrades an authored scheme-less dotted hostname to HTTPS', () => {
    expect(resolve('access.rv.com')).toEqual({
      kind: 'web',
      url: 'https://access.rv.com/',
      hostname: 'access.rv.com',
    });
  });

  it.each([' access.rv.com', 'access.rv.com ', '/access.rv.com', '\\\\access.rv.com\\share'])(
    'rejects an unsafe scheme-less hostname form: %s',
    (rawUrl) => {
      expect(resolve(rawUrl)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    },
  );

  it.each([
    ' https://example.com/runbook',
    'https://example.com/runbook ',
    'https://operator@example.com/runbook',
    'https://operator:secret@example.com/runbook',
  ])('rejects a web URL the main-process boundary must reject: %s', (rawUrl) => {
    expect(resolve(rawUrl)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
  });

  it('reports a missing PDF target', () => {
    expect(resolve('Missing.pdf')).toEqual({ kind: 'unavailable', reason: 'not-found' });
  });

  it('reports duplicate filenames as ambiguous without a matching relative path', () => {
    const first = document('first', 'One/Guide.pdf');
    const second = document('second', 'Two/Guide.pdf');

    expect(resolve('Guide.pdf', [currentDocument, first, second])).toEqual({
      kind: 'unavailable',
      reason: 'ambiguous',
    });
  });

  it.each(['/One/Guide.pdf', 'C:\\One\\Guide.pdf', 'file:///One/Guide.pdf'])(
    'never uses absolute author path %s to disambiguate duplicates',
    (rawUrl) => {
      const first = document('first', 'One/Guide.pdf');
      const second = document('second', 'Two/Guide.pdf');

      expect(resolve(rawUrl, [currentDocument, first, second])).toEqual({
        kind: 'unavailable',
        reason: 'ambiguous',
      });
    },
  );

  it('rejects traversal above the virtual Knowledge root', () => {
    const first = document('first', 'One/Guide.pdf');
    const second = document('second', 'Two/Guide.pdf');

    expect(resolve('../../Guide.pdf', [currentDocument, first, second])).toEqual({
      kind: 'unavailable',
      reason: 'unsupported',
    });
  });

  it('rejects traversal above the virtual Knowledge root for a unique filename', () => {
    const target = document('guide', 'Reference/Guide.pdf');

    expect(resolve('../../Guide.pdf', [currentDocument, target])).toEqual({
      kind: 'unavailable',
      reason: 'unsupported',
    });
  });

  it.each(['Notes.txt', 'Guide.pdf/appendix', 'Guide.pdf/'])(
    'rejects non-PDF final filenames',
    (rawUrl) => {
      expect(resolve(rawUrl)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    },
  );

  it.each([
    'https://',
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Deliberately malformed HTTP exercises URL rejection.
    'http://[not-an-ipv6-address]/',
    'file://%',
    'Guide%ZZ.pdf',
  ])('rejects malformed URL %s', (rawUrl) => {
    expect(resolve(rawUrl)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
  });

  it.each(['mailto:operator@example.com', 'ftp://example.com/Guide.pdf', 'javascript:void(0)'])(
    'rejects unsupported scheme %s',
    (rawUrl) => {
      expect(resolve(rawUrl)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    },
  );

  it('rejects empty, non-string, control-character, and oversized input', () => {
    expect(resolve('')).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(resolve('Guide\u0000.pdf')).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(resolve('a'.repeat(4_097))).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(
      resolveKnowledgeLink({
        rawUrl: 42 as unknown as string,
        currentDocument,
        documents: [currentDocument],
      }),
    ).toEqual({ kind: 'unavailable', reason: 'unsupported' });
  });
});
