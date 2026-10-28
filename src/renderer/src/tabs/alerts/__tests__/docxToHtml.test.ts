import { describe, expect, it } from 'vitest';
import { docxToHtml } from '../docxToHtml';
import { guideBlocksFromPaste } from '../pasteToGuide';
import { calloutBlockHtml, stepBlockHtml } from '../alertBlocks';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const STYLES = `<w:styles ${NS}>
  <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:styleId="Caption"><w:name w:val="caption"/></w:style>
  <w:style w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`;

const NUMBERING = `<w:numbering ${NS}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg" Type="image" Target="media/shot.png"/>
  <Relationship Id="rIdEmf" Type="image" Target="media/logo.emf"/>
  <Relationship Id="rIdLink" Type="hyperlink" Target="https://portal.example.com/" TargetMode="External"/>
</Relationships>`;

const wrap = (tag: string, inner: string) =>
  inner ? '<' + tag + '>' + inner + '</' + tag + '>' : '';
const run = (text: string, props = '') =>
  `<w:r>${wrap('w:rPr', props)}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, pPr = '') => `<w:p>${wrap('w:pPr', pPr)}${content}</w:p>`;
const numbered = (content: string, numId = '1', ilvl = '0') =>
  paragraph(content, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
const styled = (style: string, content: string) =>
  paragraph(content, `<w:pStyle w:val="${style}"/>`);
const picture = (rel: string, description = 'Screenshot') =>
  `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="${description}"/>` +
  `<a:graphic><a:graphicData><a:blip r:embed="${rel}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const documentXml = (body: string) => `<w:document ${NS}><w:body>${body}</w:body></w:document>`;

/** A zip built the way Word writes one: XML parts deflated, media stored. */
async function zip(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? encoder.encode(content) : content;
    const deflate = typeof content === 'string';
    const data = deflate ? await compress(raw) : raw;
    const nameBytes = encoder.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, raw.byteLength, true);
    local.setUint16(26, nameBytes.byteLength, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, deflate ? 8 : 0, true);
    entry.setUint32(20, data.byteLength, true);
    entry.setUint32(24, raw.byteLength, true);
    entry.setUint16(28, nameBytes.byteLength, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.byteLength + data.byteLength;
  }
  const centralSize = central.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

async function compress(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(raw as BufferSource);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function docx(body: string): Promise<Blob> {
  return zip({
    'word/document.xml': documentXml(body),
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    'word/_rels/document.xml.rels': RELS,
    'word/media/shot.png': new Uint8Array([137, 80, 78, 71]),
    'word/media/logo.emf': new Uint8Array([1, 0, 0, 0]),
  });
}

const prepare = async (file: Blob) => `data:${file.type};base64,AAAA`;
const IMG = (alt: string) => `<img alt="${alt}" src="data:image/png;base64,AAAA">`;

describe('docxToHtml', () => {
  it('reads headings, runs, numbered steps with their follow-on content, and links', async () => {
    const file = await docx(
      styled('Heading1', run('Reset MFA')) +
        paragraph(run('Use this for new phones.')) +
        numbered(run('Open the portal.', '<w:b/>') + run(' Sign in as admin.')) +
        paragraph(run('Use the admin account.'), '<w:ind w:left="720"/>') +
        numbered(run('Corp VPN'), '1', '1') +
        numbered(run('Find the user')) +
        paragraph(picture('rIdImg', 'User search')) +
        styled('Caption', run('The search box is at the top.')) +
        paragraph(run('Warning: ', '<w:b/>') + run('This signs them out.')) +
        paragraph(`<w:hyperlink r:id="rIdLink">${run('Open the portal')}</w:hyperlink>`),
    );

    const { html, skippedImages } = await docxToHtml(file, prepare);

    expect(skippedImages).toBe(0);
    expect(html).toBe(
      '<h1>Reset MFA</h1><p>Use this for new phones.</p>' +
        '<ol><li><strong>Open the portal.</strong> Sign in as admin.' +
        '<p>Use the admin account.</p><ul><li>Corp VPN</li></ul></li>' +
        `<li>Find the user<figure>${IMG('User search')}<figcaption>The search box is at the top.</figcaption></figure></li></ol>` +
        '<p><strong>Warning: </strong>This signs them out.</p>' +
        '<p><a href="https://portal.example.com/">Open the portal</a></p>',
    );
  });

  it('becomes guide steps through smart paste, pictures and nested bullets kept in their step', async () => {
    const file = await docx(
      numbered(run('Open the portal.', '<w:b/>') + run(' Sign in as admin.')) +
        numbered(run('Corp VPN'), '1', '1') +
        numbered(run('Find the user')) +
        paragraph(picture('rIdImg', 'User search')) +
        paragraph(run('Note: it can take a minute.')),
    );

    const { html } = await docxToHtml(file, prepare);
    const figure =
      '<figure class="alert-body-figure"><img src="data:image/png;base64,AAAA" alt="User search" class="alert-body-image"><figcaption></figcaption></figure>';

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml('Open the portal', '<p>Sign in as admin.</p><ul><li>Corp VPN</li></ul>') +
        stepBlockHtml('Find the user', figure) +
        calloutBlockHtml('note', '<p>Note: it can take a minute.</p>'),
    );
  });

  it('captions a picture whose short caption shares its paragraph', async () => {
    const file = await docx(
      numbered(run('Choose Reset')) +
        paragraph(picture('rIdImg', 'Methods') + run(' It is under the list.')),
    );

    const { html } = await docxToHtml(file, prepare);

    expect(html).toBe(
      `<ol><li>Choose Reset<figure>${IMG('Methods')}<figcaption>It is under the list.</figcaption></figure></li></ol>`,
    );
  });

  it('keeps bullets outside steps, flattens tables to rows, and counts pictures it cannot show', async () => {
    const file = await docx(
      numbered(run('A bullet'), '2') +
        numbered(run('Another'), '2') +
        paragraph(picture('rIdEmf', 'Logo') + run('Contact the desk')) +
        '<w:tbl><w:tr><w:tc>' +
        paragraph(run('Site')) +
        '</w:tc><w:tc>' +
        paragraph(run('Portal', '<w:i/>')) +
        '</w:tc></w:tr></w:tbl>',
    );

    const { html, skippedImages } = await docxToHtml(file, prepare);

    expect(skippedImages).toBe(1);
    expect(html).toBe(
      '<ul><li>A bullet</li><li>Another</li></ul><p>Contact the desk</p><p>Site | <em>Portal</em></p>',
    );
  });

  it('refuses files that are not Word documents', async () => {
    await expect(docxToHtml(new Blob(['not a zip']), prepare)).rejects.toThrow(
      'Not a zip archive.',
    );
    await expect(docxToHtml(await zip({ 'readme.txt': 'hello' }), prepare)).rejects.toThrow(
      'This is not a Word document.',
    );
  });
});
