import { describe, expect, it } from 'vitest';
import { extractKnowledgeSearchPages } from './knowledgeSearchExtraction';

function buildPdf({ outline = false, text = true }: { outline?: boolean; text?: boolean } = {}) {
  const pageStreams = text
    ? [
        'BT\n/F1 12 Tf\n72 700 Td\n(Primary Recovery Procedure) Tj\nET',
        'BT\n/F1 12 Tf\n72 700 Td\n(Escalation Matrix) Tj\nET',
      ]
    : ['', ''];
  const catalogExtras = outline ? ' /Outlines 9 0 R /PageMode /UseOutlines' : '';
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${catalogExtras} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `6 0 obj\n<< /Length ${Buffer.byteLength(pageStreams[0] ?? '')} >>\nstream\n${pageStreams[0]}\nendstream\nendobj\n`,
    `7 0 obj\n<< /Length ${Buffer.byteLength(pageStreams[1] ?? '')} >>\nstream\n${pageStreams[1]}\nendstream\nendobj\n`,
    '8 0 obj\n<< /Title (Search Fixture) >>\nendobj\n',
    ...(outline
      ? [
          '9 0 obj\n<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 1 >>\nendobj\n',
          '10 0 obj\n<< /Title (Recovery) /Parent 9 0 R /Dest [3 0 R /XYZ 0 700 null] >>\nendobj\n',
        ]
      : []),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

describe('extractKnowledgeSearchPages', () => {
  it('extracts every page even when the PDF has a native outline', async () => {
    const pages = await extractKnowledgeSearchPages(buildPdf({ outline: true }));

    expect(pages.map(({ pageNumber }) => pageNumber)).toEqual([1, 2]);
    expect(pages.map(({ items }) => items.map(({ str }) => str).join(' '))).toEqual([
      expect.stringContaining('Primary Recovery Procedure'),
      expect.stringContaining('Escalation Matrix'),
    ]);
  });

  it('keeps image-only pages as empty searchable pages', async () => {
    const pages = await extractKnowledgeSearchPages(buildPdf({ text: false }));

    expect(pages).toEqual([
      { pageNumber: 1, items: [] },
      { pageNumber: 2, items: [] },
    ]);
  });
});
