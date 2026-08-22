import { createHash } from 'node:crypto';

const DEFAULT_DOCUMENTS = [
  {
    category: 'Operations',
    title: 'Incident Response Quick Start',
    fileName: 'Incident Response Quick Start.pdf',
  },
  {
    category: 'Network',
    title: 'VPN Access Troubleshooting',
    fileName: 'VPN Access Troubleshooting.pdf',
  },
];

function escapePdfText(value) {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`);
}

export function buildSeedKnowledgePdf(title) {
  const content = `BT /F1 18 Tf 72 720 Td (${escapePdfText(title)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

export async function seedKnowledgeDocuments({
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  documents = DEFAULT_DOCUMENTS,
}) {
  const timestamp = now().toISOString();
  const created = [];

  for (const document of documents) {
    const pdf = buildSeedKnowledgePdf(document.title);
    const checksum = createHash('sha256').update(pdf).digest('hex');
    const sourceKey = `${document.category}/${document.fileName}`;
    const form = new FormData();
    form.set('sourceKey', sourceKey);
    form.set('category', document.category);
    form.set('title', document.title);
    form.set('displayTitle', document.title);
    form.set('fileName', document.fileName);
    form.set('pdf', new Blob([pdf], { type: 'application/pdf' }), document.fileName);
    form.set('checksum', checksum);
    form.set('byteSize', String(pdf.byteLength));
    form.set('pageCount', '1');
    form.set('outline', JSON.stringify([]));
    form.set('outlineSource', 'none');
    form.set('sourceModifiedAt', timestamp);
    form.set('indexedAt', timestamp);
    form.set('lifecycleState', 'active');
    form.set('revision', '1');
    form.set('publishedAt', timestamp);

    const response = await fetchImpl(
      `${baseUrl.replace(/\/$/, '')}/api/collections/knowledge_documents/records`,
      {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
      },
    );
    if (!response.ok) {
      throw new Error(`Could not seed Knowledge document (${response.status})`);
    }
    created.push(await response.json());
  }

  return created;
}
