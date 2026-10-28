import { describe, expect, it } from 'vitest';
import { fontProgramName, pdfLayoutHtml, type PdfTextRun } from '../pdfToHtml';

const run = (text: string, y: number, options: Partial<PdfTextRun> = {}): PdfTextRun => ({
  text,
  x: 72,
  y,
  width: text.length * 5.5,
  size: 11,
  bold: false,
  italic: false,
  href: null,
  ...options,
});

describe('pdfLayoutHtml', () => {
  it('rebuilds headings, paragraphs, numbered lines and links from positioned text', () => {
    const html = pdfLayoutHtml([
      {
        runs: [
          run('Reset a user’s MFA', 720, { size: 20, bold: true }),
          run('Use this when someone has a new phone', 690),
          run('and cannot sign in.', 676.6),
          run('1.', 650),
          run('Open the Entra admin center.', 650, { x: 90, bold: true }),
          run('Sign in with your admin account.', 650, { x: 260 }),
          run('2. Search for the user.', 625),
          run('Warning: This signs the user out.', 600, { italic: true }),
          run('Open Entra', 575, { href: 'https://entra.microsoft.com/' }),
          run('3', 40),
        ],
        pictures: [],
        markers: [],
      },
    ]);
    expect(html).toBe(
      '<h2>Reset a user’s MFA</h2>' +
        '<p>Use this when someone has a new phone and cannot sign in.</p>' +
        '<p>1. <strong>Open the Entra admin center.</strong> Sign in with your admin account.</p>' +
        '<p>2. Search for the user.</p>' +
        '<p><em>Warning: This signs the user out.</em></p>' +
        '<p><a href="https://entra.microsoft.com/">Open Entra</a></p>',
    );
  });

  it('keeps short sentence lines apart when a list draws its bullets as shapes', () => {
    const long = 'The person is signed in to their work PC and has the share path ready to type';
    const html = pdfLayoutHtml([
      {
        runs: [
          run(long, 700),
          run('in the dialog.', 686),
          run('They are on the office network.', 672, { x: 90 }),
          run('You know the share path.', 658, { x: 90 }),
        ],
        pictures: [],
        markers: [],
      },
    ]);
    expect(html).toBe(
      `<p>${long} in the dialog.</p>` +
        '<p>They are on the office network.</p>' +
        '<p>You know the share path.</p>',
    );
  });

  it('reads Symbol-font bullets as a list and drops other private-use glyphs', () => {
    const html = pdfLayoutHtml([
      {
        runs: [
          run('\uf0b7', 500, { x: 78, width: 5 }),
          run('A bullet list stays a bullet list', 500, { x: 92 }),
          run('\uf0b7', 485, { x: 78, width: 5 }),
          run('Even with several items', 485, { x: 92 }),
          run('Done \uf0fc', 460),
        ],
        pictures: [],
        markers: [],
      },
    ]);
    expect(html).toBe(
      '<ul><li>A bullet list stays a bullet list</li><li>Even with several items</li></ul>' +
        '<p>Done</p>',
    );
  });

  it('reads small shapes drawn just left of a line as its bullet', () => {
    const html = pdfLayoutHtml([
      {
        runs: [
          run('Before you start', 520),
          run('The person is signed in to their work PC.', 500, { x: 90 }),
          run('They are on the office network.', 485, { x: 90 }),
        ],
        pictures: [],
        markers: [
          { x: 80, y: 503, size: 3 },
          { x: 80, y: 488, size: 3 },
          { x: 300, y: 488, size: 3 },
        ],
      },
    ]);
    expect(html).toBe(
      '<p>Before you start</p>' +
        '<ul><li>The person is signed in to their work PC.</li><li>They are on the office network.</li></ul>',
    );
  });

  it('does not take an icon in front of a line for its bullet', () => {
    const html = pdfLayoutHtml([
      {
        runs: [run('Note: Check the cable first.', 500, { x: 90 })],
        pictures: [],
        markers: [{ x: 80, y: 503, size: 8 }],
      },
    ]);
    expect(html).toBe('<p>Note: Check the cable first.</p>');
  });

  it('keeps a line ending in an abbreviation joined to the lowercase or path text after it', () => {
    const html = pdfLayoutHtml([
      {
        runs: [
          run('Type the full share path for the team folder, e.g.', 700),
          run('\\\\files01\\shared\\finance\\reports, then press Enter to continue.', 686),
        ],
        pictures: [],
        markers: [],
      },
    ]);
    expect(html).toBe(
      '<p>Type the full share path for the team folder, e.g. \\\\files01\\shared\\finance\\reports, then press Enter to continue.</p>',
    );
  });

  it('places pictures by height on the page and gathers bullets into one list', () => {
    const html = pdfLayoutHtml([
      {
        runs: [run('1. Open the portal.', 700), run('• Chrome', 500), run('• Edge', 486)],
        pictures: [{ top: 680, src: 'data:image/png;base64,QQ==' }],
        markers: [],
      },
      { runs: [run('2. Sign in.', 700)], pictures: [], markers: [] },
    ]);
    expect(html).toBe(
      '<p>1. Open the portal.</p>' +
        '<figure><img src="data:image/png;base64,QQ==" alt="Guide image"></figure>' +
        '<ul><li>Chrome</li><li>Edge</li></ul>' +
        '<p>2. Sign in.</p>',
    );
  });
});

/** A font program holding only a name table with one PostScript name record. */
function fontWithName(name: string, platform: number): Uint8Array {
  const text =
    platform === 1
      ? new TextEncoder().encode(name)
      : Uint8Array.from(Array.from(name).flatMap((char) => [0, char.charCodeAt(0)]));
  const tableOffset = 12 + 16;
  const data = new Uint8Array(tableOffset + 6 + 12 + text.length);
  const view = new DataView(data.buffer);
  view.setUint16(4, 1);
  view.setUint32(12, 0x6e616d65);
  view.setUint32(12 + 8, tableOffset);
  view.setUint16(tableOffset + 2, 1);
  view.setUint16(tableOffset + 4, 6 + 12);
  view.setUint16(tableOffset + 6, platform);
  view.setUint16(tableOffset + 6 + 6, 6);
  view.setUint16(tableOffset + 6 + 8, text.length);
  data.set(text, tableOffset + 6 + 12);
  return data;
}

describe('fontProgramName', () => {
  it('reads the PostScript name that tells bold and italic fonts apart', () => {
    expect(fontProgramName(fontWithName('BAAAAA+Calibri-Bold', 1))).toBe('BAAAAA+Calibri-Bold');
    expect(fontProgramName(fontWithName('Arial-ItalicMT', 3))).toBe('Arial-ItalicMT');
    expect(fontProgramName(new Uint8Array(12))).toBe('');
  });
});
