import type { PDFPageProxy } from 'pdfjs-dist/build/pdf.mjs';
import { sanitizeHttpHref } from './alertBlocks';
import type { DocxImport } from './docxToHtml';
import { startsGuideBlock } from './pasteToGuide';

/*
 * A PDF holds positioned text and pictures, not paragraphs or lists. This rebuilds lines from text
 * positions, joins lines into paragraphs by spacing, reads headings from font size and bold or
 * italic from font names, and places pictures by height on the page. Smart paste then finds the
 * guide's steps and callouts in the result. Scanned PDFs have no text, only page pictures.
 */

/** A run of text on a page, in PDF units with y measured up from the bottom of the page. */
export type PdfTextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  href: string | null;
};
export type PdfPicture = { top: number; src: string };
/** The centre and width of a small shape drawn on the page, which may be a list bullet. */
export type PdfMarker = { x: number; y: number; size: number };
export type PdfPageContent = { runs: PdfTextRun[]; pictures: PdfPicture[]; markers: PdfMarker[] };

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;
/** Smaller pictures are icons, bullets and rules, not screenshots. */
const MIN_PICTURE_SIZE = 64;
/** A gap between lines larger than this many font sizes starts a new paragraph. */
const PARAGRAPH_GAP = 1.6;
const HEADING_SCALE = 1.2;
const TITLE_SCALE = 1.6;
const BULLET_PREFIX = /^\s*[•◦▪‣●○■□–*-]\s+/;
const BULLET_CHARACTERS = '•◦▪‣●○■□–*-';
const isBulletOnly = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length <= 1 && BULLET_CHARACTERS.includes(trimmed);
};
/** Symbol and Wingdings glyphs (Word's bullets among them) sit in the private use area. */
const SYMBOL_GLYPH = /^[\uE000-\uF8FF]$/;
const SYMBOL_GLYPHS = /[\uE000-\uF8FF]/g;
/** A drawn bullet is at most this many PDF units across, and roughly square. */
const MARKER_MAX_SIZE = 9;
/** Bullets are a fraction of the text size (browsers draw 3 pt dots for 11 pt text); icons are not. */
const MARKER_MAX_TEXT_RATIO = 0.6;
/** After a short sentence line, a new paragraph starts with a capital, digit, quote or bracket. */
const PARAGRAPH_START = /^[\p{Lu}\d"'“‘(]/u;
const PAGE_NUMBER = /^\s*(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;

type Line = { y: number; end: number; size: number; runs: PdfTextRun[]; text: string };
type Paragraph = [Line, ...Line[]];
type Block = { top: number; element: HTMLElement };

const formatKey = (run: PdfTextRun) => `${run.bold}|${run.italic}|${run.href ?? ''}`;

function lineText(runs: PdfTextRun[]): string {
  let text = '';
  let end: number | null = null;
  for (const run of runs) {
    const gap = end === null ? 0 : run.x - end;
    if (text && gap > run.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(run.text)) text += ' ';
    text += run.text;
    end = run.x + run.width;
  }
  return text;
}

/** A lone symbol glyph reads as a bullet; symbol glyphs inside text have no meaning as text. */
const symbolText = (text: string) =>
  SYMBOL_GLYPH.test(text) ? '•' : text.replaceAll(SYMBOL_GLYPHS, '');

/** Gives a line a bullet when a small shape is drawn just left of its first word. */
function markBullet(line: Line, markers: PdfMarker[]): void {
  const first = line.runs[0];
  if (!first || BULLET_PREFIX.test(line.text)) return;
  const bullet = markers.some(
    (marker) =>
      marker.size <= line.size * MARKER_MAX_TEXT_RATIO &&
      marker.x < first.x &&
      first.x - marker.x <= line.size * 2.5 &&
      marker.y >= line.y - line.size * 0.2 &&
      marker.y <= line.y + line.size * 0.9,
  );
  if (bullet) line.text = `• ${line.text}`;
}

/** Groups runs into lines, top to bottom, each line's runs left to right. */
export function linesOf(runs: PdfTextRun[], markers: PdfMarker[] = []): Line[] {
  const sorted = runs
    .map((run) => ({ ...run, text: symbolText(run.text) }))
    .filter((run) => run.text)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - run.y) <= Math.max(line.size, run.size) * 0.4) {
      line.runs.push(run);
      line.size = Math.max(line.size, run.size);
    } else {
      lines.push({ y: run.y, end: 0, size: run.size, runs: [run], text: '' });
    }
  }
  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    line.text = lineText(line.runs).trim();
    line.end = Math.max(...line.runs.map((run) => run.x + run.width));
  }
  for (const line of lines) markBullet(line, markers);
  return lines.filter((line) => line.text && !PAGE_NUMBER.test(line.text));
}

/** The most common font size by amount of text, which is the body text size. */
export function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    for (const run of line.runs) {
      const size = Math.round(run.size * 2) / 2;
      weight.set(size, (weight.get(size) ?? 0) + run.text.length);
    }
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, total] of weight) {
    if (total > bestWeight) [best, bestWeight] = [size, total];
  }
  return best || 12;
}

/** Runs as inline HTML, with neighbouring runs of the same format merged. */
function inline(runs: PdfTextRun[], plain: boolean): Node[] {
  const nodes: Node[] = [];
  let key = '';
  let text = '';
  let template: PdfTextRun | null = null;
  const flush = () => {
    if (template && text) nodes.push(formattedNode(text, template, plain));
    text = '';
  };
  let end: number | null = null;
  for (const run of runs) {
    const gap = end === null ? 0 : run.x - end;
    const spaced = gap > run.size * 0.15 && !/^\s/.test(run.text);
    if (end !== null && spaced && !/\s$/.test(text)) text += ' ';
    if (formatKey(run) !== key) {
      // A space where the format changes sits between the two, outside bold, italic and links.
      const spaceBetween = /\s$/.test(text);
      text = text.trimEnd();
      flush();
      if (spaceBetween) nodes.push(document.createTextNode(' '));
      key = formatKey(run);
      template = run;
    }
    text += run.text;
    end = run.x + run.width;
  }
  flush();
  return nodes;
}

function formattedNode(text: string, run: PdfTextRun, plain: boolean): Node {
  let node: Node = document.createTextNode(text);
  if (plain) return node;
  for (const [on, tag] of [
    [run.italic, 'em'],
    [run.bold, 'strong'],
  ] as const) {
    if (!on) continue;
    const wrapper = document.createElement(tag);
    wrapper.append(node);
    node = wrapper;
  }
  if (run.href) {
    const link = document.createElement('a');
    link.setAttribute('href', run.href);
    link.append(node);
    node = link;
  }
  return node;
}

/** A line ending a sentence well short of the text's right edge ends its paragraph. */
const SHORT_LINE_MARGIN = 4;
const endsShort = (line: Line, rightEdge: number) =>
  /[.!?:]$/.test(line.text) && line.end < rightEdge - line.size * SHORT_LINE_MARGIN;

/**
 * Joins lines into paragraphs; a new one starts at a wide gap, a size change, a step label, or
 * after a sentence that stops short of the right edge (list items whose bullets are drawn shapes).
 */
function paragraphsOf(lines: Line[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const rightEdge = Math.max(0, ...lines.map((line) => line.end));
  let previous: Line | null = null;
  for (const line of lines) {
    const current = paragraphs.at(-1);
    const joins =
      current &&
      previous &&
      previous.y - line.y <= Math.max(previous.size, line.size) * PARAGRAPH_GAP &&
      Math.abs(previous.size - line.size) <= 1 &&
      !(endsShort(previous, rightEdge) && PARAGRAPH_START.test(line.text)) &&
      !startsGuideBlock(line.text) &&
      !BULLET_PREFIX.test(line.text);
    if (joins) current.push(line);
    else paragraphs.push([line]);
    previous = line;
  }
  return paragraphs;
}

function joinedRuns(paragraph: Paragraph): PdfTextRun[] {
  const runs = linesRuns(paragraph);
  const last = runs.at(-1);
  if (last) runs[runs.length - 1] = { ...last, text: last.text.trimEnd() };
  return withoutBullet(paragraph, runs);
}

function linesRuns(paragraph: Paragraph): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  for (const [index, line] of paragraph.entries()) {
    // Lines of one paragraph join with a space in the format of the line before.
    const last = runs.at(-1);
    if (index > 0 && last) runs.push({ ...last, text: ' ', x: -1, width: 0 });
    runs.push(...line.runs);
  }
  return runs;
}

function withoutBullet(paragraph: Paragraph, runs: PdfTextRun[]): PdfTextRun[] {
  if (!BULLET_PREFIX.test(paragraph[0].text)) return runs;
  // The bullet may be its own run (a symbol glyph), part of the first run, or only a drawn shape.
  while (runs.length > 1 && isBulletOnly(runs[0]?.text ?? '')) runs.shift();
  const [first, ...rest] = runs;
  return first
    ? [{ ...first, text: first.text.replace(BULLET_PREFIX, '').trimStart() }, ...rest]
    : rest;
}

function blockFor(paragraph: Paragraph, body: number, title: number): HTMLElement {
  const size = Math.max(...paragraph.map((line) => line.size));
  const runs = joinedRuns(paragraph);
  let element: HTMLElement;
  if (size >= body * HEADING_SCALE) {
    element = document.createElement(size >= title && size >= body * TITLE_SCALE ? 'h2' : 'h3');
    element.append(...inline(runs, true));
  } else {
    element = document.createElement(BULLET_PREFIX.test(paragraph[0].text) ? 'li' : 'p');
    element.append(...inline(runs, false));
  }
  return element;
}

/** The pages as HTML: headings, paragraphs, bullet lists and pictures in reading order. */
export function pdfLayoutHtml(pages: PdfPageContent[]): string {
  const allLines = pages.flatMap((page) => linesOf(page.runs, page.markers));
  const body = bodySize(allLines);
  const title = Math.max(body, ...allLines.map((line) => line.size));
  const container = document.createElement('div');
  let list: HTMLUListElement | null = null;
  for (const page of pages) {
    const blocks: Block[] = paragraphsOf(linesOf(page.runs, page.markers)).map((paragraph) => ({
      top: paragraph[0].y + paragraph[0].size,
      element: blockFor(paragraph, body, title),
    }));
    for (const picture of page.pictures) {
      const figure = document.createElement('figure');
      const img = document.createElement('img');
      img.setAttribute('src', picture.src);
      img.setAttribute('alt', 'Guide image');
      figure.append(img);
      blocks.push({ top: picture.top, element: figure });
    }
    blocks.sort((a, b) => b.top - a.top);
    for (const { element } of blocks) {
      if (element.localName !== 'li') {
        list = null;
        container.append(element);
        continue;
      }
      list ??= container.appendChild(document.createElement('ul'));
      list.append(element);
    }
  }
  return container.innerHTML;
}

/* --- Reading with pdf.js --- */

type PdfJs = typeof import('pdfjs-dist/build/pdf.mjs');
type Matrix = [number, number, number, number, number, number];
type Rect = [number, number, number, number];
type LinkArea = { rect: Rect; href: string };
type DecodedImage = {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
};

async function loadPdfJs(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc ||= worker.default;
  return pdfjs;
}

const NAME_TABLE = 0x6e616d65; // 'name'
const POSTSCRIPT_NAME = 6;

/**
 * The PostScript name ("ABCDEF+Calibri-Bold") in the name table of the font program pdf.js hands
 * back; pdf.js 6 does not report bold or italic for fonts embedded in the PDF.
 */
export function fontProgramName(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = view.getUint16(4);
  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    if (view.getUint32(record) !== NAME_TABLE) continue;
    const table = view.getUint32(record + 8);
    const strings = table + view.getUint16(table + 4);
    for (let entry = 0; entry < view.getUint16(table + 2); entry += 1) {
      const name = table + 6 + entry * 12;
      if (view.getUint16(name + 6) !== POSTSCRIPT_NAME) continue;
      const start = strings + view.getUint16(name + 10);
      const bytes = data.subarray(start, start + view.getUint16(name + 8));
      // Windows and Unicode names are UTF-16BE; Macintosh names are one byte per character.
      const wide = view.getUint16(name) !== 1;
      return new TextDecoder(wide ? 'utf-16be' : 'latin1').decode(bytes);
    }
  }
  return '';
}

/** Bold and italic read from the font's name, once the page's fonts are loaded. */
function fontStyle(page: PDFPageProxy, fontName: string): { bold: boolean; italic: boolean } {
  let name = '';
  try {
    const font = page.commonObjs.has(fontName)
      ? (page.commonObjs.get(fontName) as { data?: Uint8Array } | null)
      : null;
    name = font?.data ? fontProgramName(font.data) : '';
  } catch {
    // A font pdf.js could not load reads as regular text.
  }
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

async function linkAreas(page: PDFPageProxy): Promise<LinkArea[]> {
  const annotations = (await page.getAnnotations()) as Array<{
    subtype?: string;
    url?: string;
    rect?: Rect;
  }>;
  return annotations.flatMap((annotation) => {
    const href = annotation.subtype === 'Link' ? sanitizeHttpHref(annotation.url ?? '') : null;
    return href && annotation.rect ? [{ rect: annotation.rect, href }] : [];
  });
}

const inside = (rect: Rect, x: number, y: number) =>
  x >= Math.min(rect[0], rect[2]) &&
  x <= Math.max(rect[0], rect[2]) &&
  y >= Math.min(rect[1], rect[3]) &&
  y <= Math.max(rect[1], rect[3]);

async function textRuns(page: PDFPageProxy): Promise<PdfTextRun[]> {
  const [content, links] = await Promise.all([page.getTextContent(), linkAreas(page)]);
  const runs: PdfTextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const [, , c, d, x, y] = item.transform as Matrix;
    const size = Math.hypot(c, d);
    const middle = x + item.width / 2;
    const link = links.find((area) => inside(area.rect, middle, y + size / 3));
    runs.push({
      text: item.str,
      x,
      y,
      width: item.width,
      size,
      ...fontStyle(page, item.fontName),
      href: link?.href ?? null,
    });
  }
  return runs;
}

type Placement = { id: string; top: number };

/** A painted path's box in page units, as a bullet marker when it is small and roughly square. */
function markerOf(pdfjs: PdfJs, matrix: Matrix, args: unknown[]): PdfMarker | null {
  const { OPS, Util } = pdfjs;
  const [paint, , bounds] = args as [number, unknown, ArrayLike<number> | null];
  if (paint === OPS.endPath || !bounds || bounds.length < 4) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number];
  Util.axialAlignedBoundingBox(bounds, matrix, box);
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  const square = width > 1 && height > 1 && width / height > 0.6 && width / height < 1.7;
  if (!square || width > MARKER_MAX_SIZE || height > MARKER_MAX_SIZE) return null;
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, size: Math.max(width, height) };
}

/**
 * Walks the page's drawing operations: each drawn picture's object id and the top of the box it is
 * drawn into, and the centres of small painted shapes that may be list bullets.
 */
function pageGraphics(
  pdfjs: PdfJs,
  operators: { fnArray: number[]; argsArray: unknown[][] },
): { placements: Placement[]; markers: PdfMarker[] } {
  const { OPS, Util } = pdfjs;
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  const placements: Placement[] = [];
  const markers: PdfMarker[] = [];
  operators.fnArray.forEach((fn, index) => {
    const args = operators.argsArray[index] ?? [];
    if (fn === OPS.save) saved.push(matrix);
    else if (fn === OPS.restore) matrix = saved.pop() ?? matrix;
    else if (fn === OPS.transform) matrix = Util.transform(matrix, args as Matrix) as Matrix;
    else if (fn === OPS.constructPath) {
      const marker = markerOf(pdfjs, matrix, args);
      if (marker) markers.push(marker);
    } else if (fn === OPS.paintImageXObject && typeof args[0] === 'string') {
      const width = Math.hypot(matrix[0], matrix[1]);
      const height = Math.hypot(matrix[2], matrix[3]);
      if (width < MIN_PICTURE_SIZE || height < MIN_PICTURE_SIZE) return;
      placements.push({ id: args[0], top: Math.max(matrix[5], matrix[5] + matrix[3]) });
    }
  });
  return { placements, markers };
}

function rgbaPixels(image: DecodedImage): Uint8ClampedArray<ArrayBuffer> | null {
  const { data, width, height } = image;
  if (!data) return null;
  const count = width * height;
  if (data.length === count * 4) return new Uint8ClampedArray(data);
  if (data.length !== count * 3) return null;
  const rgba = new Uint8ClampedArray(count * 4);
  for (let source = 0, target = 0; source < data.length; source += 3, target += 4) {
    rgba.set(data.subarray(source, source + 3), target);
    rgba[target + 3] = 255;
  }
  return rgba;
}

async function imageBlob(image: DecodedImage): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = image.bitmap?.width ?? image.width;
  canvas.height = image.bitmap?.height ?? image.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0);
  } else {
    const pixels = rgbaPixels(image);
    if (!pixels) return null;
    context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function pageObject(page: PDFPageProxy, id: string): Promise<DecodedImage | null> {
  const objects = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      objects.get(id, (value: unknown) => resolve((value as DecodedImage | null) ?? null));
    } catch {
      resolve(null);
    }
  });
}

async function pageGraphicsContent(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  prepare: (file: Blob) => Promise<string>,
): Promise<{ pictures: PdfPicture[]; markers: PdfMarker[]; skipped: number }> {
  const { placements, markers } = pageGraphics(pdfjs, await page.getOperatorList());
  const pictures: PdfPicture[] = [];
  let skipped = 0;
  for (const { id, top } of placements) {
    const image = await pageObject(page, id);
    const blob = image ? await imageBlob(image) : null;
    const src = blob ? await prepare(blob).catch(() => null) : null;
    if (src) pictures.push({ top, src });
    else skipped += 1;
  }
  return { pictures, markers, skipped };
}

/** The PDF's text and pictures as HTML; pictures that cannot be decoded are counted. */
export async function pdfToHtml(
  file: Blob,
  prepareImage: (file: Blob) => Promise<string>,
): Promise<DocxImport> {
  if (file.size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 50 MB.');
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    // Keeps each font program after loading, so its name can tell bold and italic apart.
    fontExtraProperties: true,
    useWorkerFetch: false,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error('This PDF has more than 50 pages.');
    const pages: PdfPageContent[] = [];
    let skippedImages = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      // The operator list loads the page's fonts, which the text runs read bold and italic from.
      const { pictures, markers, skipped } = await pageGraphicsContent(pdfjs, page, prepareImage);
      pages.push({ runs: await textRuns(page), pictures, markers });
      skippedImages += skipped;
      page.cleanup();
    }
    return { html: pdfLayoutHtml(pages), skippedImages };
  } finally {
    await task.destroy();
  }
}
