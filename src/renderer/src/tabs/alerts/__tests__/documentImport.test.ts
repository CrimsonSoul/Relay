import { describe, expect, it, vi } from 'vitest';
import { documentKindOf, htmlFileToHtml } from '../documentImport';

const file = (name: string, type = '', body: BlobPart = '') => new File([body], name, { type });

describe('documentKindOf', () => {
  it('reads the kind from the type or, when the type is missing, the extension', () => {
    expect(documentKindOf(file('Guide.DOCX'))).toBe('docx');
    expect(documentKindOf(file('scan', 'application/pdf'))).toBe('pdf');
    expect(documentKindOf(file('Guide.htm'))).toBe('html');
    expect(documentKindOf(file('Guide.html', 'text/html'))).toBe('html');
    expect(documentKindOf(file('Old.doc'))).toBe('legacy-word');
    expect(documentKindOf(file('shot.png', 'image/png'))).toBeNull();
  });
});

describe('htmlFileToHtml', () => {
  it('decodes the charset the page names, as Word saves pages', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(
        '<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head><body><p>Caf',
      ),
      0xe9,
      ...new TextEncoder().encode(' – done</p></body></html>'),
    ]);
    const result = await htmlFileToHtml(file('Guide.htm', 'text/html', bytes), vi.fn());
    expect(result.html).toContain('Café');
  });

  it('decodes a page saved as UTF-16 by its byte order mark', async () => {
    const text = '<p>Café</p>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    Array.from(text).forEach((char, index) => bytes.set([char.charCodeAt(0), 0], 2 + index * 2));
    const result = await htmlFileToHtml(file('Guide.htm', 'text/html', bytes), vi.fn());
    expect(result.html).toBe('<p>Café</p>');
  });

  it('prepares embedded pictures and counts pictures it cannot read', async () => {
    const prepare = vi.fn(async (_picture: Blob) => 'data:image/jpeg;base64,QQ==');
    const result = await htmlFileToHtml(
      file(
        'Guide.html',
        'text/html',
        '<p>One<img src="data:image/png;base64,iVBO Rw0K"></p>' +
          '<p>Two<img src="https://example.com/a.png"><img src="data:image/svg+xml;base64,PHN2Zz4="></p>',
      ),
      prepare,
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(result).toEqual({
      html: '<p>One<img src="data:image/jpeg;base64,QQ=="></p><p>Two</p>',
      skippedImages: 2,
    });
  });
});
