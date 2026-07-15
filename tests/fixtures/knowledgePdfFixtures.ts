import fs from 'node:fs';
import path from 'node:path';

export type KnowledgePdfFixtureLink =
  | { kind: 'uri'; label: string; uri: string }
  | { kind: 'destination'; label: string; pageIndex: number; top: number };

type PdfObjectTable = {
  reserve(): number;
  set(objectId: number, value: string): void;
  values(): string[];
};

const MAX_LINKS_PER_PAGE = 10;

function createObjectTable(): PdfObjectTable {
  const objects: string[] = [];
  return {
    reserve() {
      objects.push('');
      return objects.length;
    },
    set(objectId, value) {
      objects[objectId - 1] = `${objectId} 0 obj\n${value}\nendobj\n`;
    },
    values() {
      return objects;
    },
  };
}

function pdfLiteralString(value: string): string {
  // eslint-disable-next-line no-control-regex -- Test PDFs must reject raw control bytes.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('PDF fixture text must not contain control characters');
  }
  return value.replace(/[\\()]/g, '\\$&');
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

export function buildKnowledgePdfFixture(input: {
  title: string;
  pageCount: number;
  links?: KnowledgePdfFixtureLink[];
}): Uint8Array {
  const { title, pageCount, links = [] } = input;
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF fixture pageCount must be a positive integer');
  }
  if (links.length > MAX_LINKS_PER_PAGE) {
    throw new Error(`PDF fixtures support at most ${MAX_LINKS_PER_PAGE} links on page 1`);
  }

  const table = createObjectTable();
  const catalogObject = table.reserve();
  const pagesObject = table.reserve();
  const fontObject = table.reserve();
  const infoObject = table.reserve();
  const pages = Array.from({ length: pageCount }, () => ({
    pageObject: table.reserve(),
    contentObject: table.reserve(),
  }));
  const annotations = links.map((link) => ({ link, object: table.reserve() }));

  table.set(catalogObject, `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);
  const pageReferences = pages.map(({ pageObject }) => `${pageObject} 0 R`).join(' ');
  table.set(pagesObject, `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`);
  table.set(fontObject, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  table.set(infoObject, `<< /Title (${pdfLiteralString(title)}) >>`);

  pages.forEach(({ pageObject, contentObject }, pageIndex) => {
    const contentLines = [
      'BT',
      '/F1 18 Tf',
      `1 0 0 1 72 730 Tm`,
      `(${pdfLiteralString(title)}) Tj`,
      '/F1 12 Tf',
      `1 0 0 1 72 700 Tm`,
      `(Page ${pageIndex + 1}) Tj`,
    ];
    if (pageIndex === 0) {
      annotations.forEach(({ link }, linkIndex) => {
        const baseline = 640 - linkIndex * 48;
        contentLines.push(`1 0 0 1 72 ${baseline} Tm`, `(${pdfLiteralString(link.label)}) Tj`);
      });
    }
    contentLines.push('ET');
    const stream = contentLines.join('\n');
    const annotationObjectReferences = annotations.map(({ object }) => `${object} 0 R`).join(' ');
    const annotationReferences =
      pageIndex === 0 && annotations.length > 0 ? ` /Annots [${annotationObjectReferences}]` : '';
    table.set(
      pageObject,
      `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R${annotationReferences} >>`,
    );
    table.set(
      contentObject,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });

  annotations.forEach(({ link, object }, linkIndex) => {
    const baseline = 640 - linkIndex * 48;
    const rectangle = `[68 ${baseline - 6} 544 ${baseline + 16}]`;
    const action =
      link.kind === 'uri'
        ? `/A << /S /URI /URI (${pdfLiteralString(link.uri)}) >>`
        : `/Dest [${pages[link.pageIndex]?.pageObject ?? 0} 0 R /XYZ 0 ${finiteNumber(link.top, 'destination top')} null]`;
    if (link.kind === 'destination' && !pages[link.pageIndex]) {
      throw new Error('PDF fixture destination pageIndex is out of range');
    }
    table.set(
      object,
      `<< /Type /Annot /Subtype /Link /Rect ${rectangle} /Border [0 0 0] ${action} >>`,
    );
  });

  const objects = table.values();
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let objectId = 1; objectId <= objects.length; objectId += 1) {
    body += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R /Info ${infoObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

export function writeKnowledgeLinkFixtures(knowledgeRoot: string): void {
  const fixtures = [
    {
      relativePath: path.join('General', 'Link navigation test.pdf'),
      data: buildKnowledgePdfFixture({
        title: 'Link navigation test',
        pageCount: 2,
        links: [
          {
            kind: 'destination' as const,
            label: 'Continue on page 2',
            pageIndex: 1,
            top: 700,
          },
          {
            kind: 'uri' as const,
            label: 'Open the payment degradation guide',
            uri: '../Platform operations/Payment API Degradation Guide.pdf#page=2',
          },
          {
            kind: 'uri' as const,
            label: 'Open the checkout incident runbook',
            uri: 'file:///C:/Users/Author/Documents/Checkout%20Service%20Incident%20Runbook.pdf',
          },
          {
            kind: 'uri' as const,
            label: 'Open the Relay knowledge test website',
            uri: 'https://example.com/relay-knowledge-test',
          },
        ],
      }),
    },
    {
      relativePath: path.join('Platform operations', 'Payment API Degradation Guide.pdf'),
      data: buildKnowledgePdfFixture({
        title: 'Payment API Degradation Guide',
        pageCount: 2,
      }),
    },
    {
      relativePath: path.join('Checkout operations', 'Checkout Service Incident Runbook.pdf'),
      data: buildKnowledgePdfFixture({
        title: 'Checkout Service Incident Runbook',
        pageCount: 1,
      }),
    },
  ];

  for (const fixture of fixtures) {
    const target = path.join(knowledgeRoot, fixture.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixture.data);
  }
}
