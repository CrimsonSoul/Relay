import { describe, expect, it } from 'vitest';
import { extractKnowledgePdf } from './knowledgeExtractor';

function buildPdf({
  outline = false,
  text = true,
  title = 'Operations Runbook',
}: { outline?: boolean; text?: boolean; title?: string } = {}) {
  const stream = text
    ? 'BT\n/F1 24 Tf\n72 700 Td\n(Overview) Tj\n/F1 12 Tf\n0 -50 Td\n(This paragraph contains the operational details for the runbook.) Tj\nET'
    : '';
  const catalogExtras = outline ? ' /Outlines 7 0 R /PageMode /UseOutlines' : '';
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${catalogExtras} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Title (${title}) >>\nendobj\n`,
    ...(outline
      ? [
          '7 0 obj\n<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>\nendobj\n',
          '8 0 obj\n<< /Title (Overview) /Parent 7 0 R /Dest [3 0 R /XYZ 0 700 null] >>\nendobj\n',
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
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

describe('extractKnowledgePdf', () => {
  it('prefers a native PDF outline and resolves its destination', async () => {
    const result = await extractKnowledgePdf(buildPdf({ outline: true }));

    expect(result).toMatchObject({
      metadataTitle: 'Operations Runbook',
      pageCount: 1,
      outlineSource: 'native',
    });
    expect(result.outline).toEqual([
      expect.objectContaining({ label: 'Overview', level: 1, pageIndex: 0, top: 700 }),
    ]);
  });

  it('infers headings when a readable PDF has no native outline', async () => {
    const result = await extractKnowledgePdf(buildPdf());

    expect(result.outlineSource).toBe('inferred');
    expect(result.outline).toEqual([
      expect.objectContaining({ label: 'Overview', level: 1, pageIndex: 0 }),
    ]);
  });

  it('returns an empty outline for a readable image-only-style PDF without text', async () => {
    const result = await extractKnowledgePdf(buildPdf({ text: false }));

    expect(result).toMatchObject({ pageCount: 1, outline: [], outlineSource: 'none' });
  });

  it('discards metadata titles containing control characters', async () => {
    const result = await extractKnowledgePdf(buildPdf({ title: 'Unsafe\u0007Title' }));

    expect(result.metadataTitle).toBeNull();
  });

  it('rejects malformed PDF bytes', async () => {
    await expect(
      extractKnowledgePdf(new Uint8Array(Buffer.from('%PDF-not-valid'))),
    ).rejects.toThrow('invalid-pdf');
  });
});
