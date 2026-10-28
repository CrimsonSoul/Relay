import { openZip, type ZipArchive } from './zipEntries';

/*
 * Reads a Word document (.docx) into the HTML a paste would give smart paste: headings, numbered
 * steps holding their indented follow-on paragraphs and pictures, bullets, bold/italic/underline
 * runs, external links, captions and table rows. Pictures come straight from the document's media
 * folder, so they arrive at full quality, unlike Word's clipboard copy. The result is unsanitized;
 * the caller sanitizes it like any paste.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

type Relationship = { target: string; external: boolean };
type StyleInfo = { name: string; basedOn?: string; numId?: string; ilvl?: number };
type ParagraphInfo = {
  heading: number | null;
  caption: boolean;
  listStyle: boolean;
  numFormat: string | null;
  ilvl: number;
  indented: boolean;
};

export type DocxImport = { html: string; skippedImages: number };

const children = (element: Element, localName: string) =>
  Array.from(element.children).filter((child) => child.localName === localName);
const child = (element: Element | undefined | null, localName: string) =>
  element ? children(element, localName)[0] : undefined;
const wAttr = (element: Element | undefined, name: string) =>
  element?.getAttributeNS(W, name) ?? element?.getAttribute(`w:${name}`) ?? null;
const isOn = (element: Element | undefined) => {
  if (!element) return false;
  const value = wAttr(element, 'val');
  return value === null || !['0', 'false', 'none'].includes(value);
};

async function readXml(zip: ZipArchive, name: string): Promise<Document | null> {
  const bytes = await zip.read(name);
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

/** "media/image1.png" relative to word/, with ../ and absolute targets resolved. */
function partPath(target: string): string {
  const segments: string[] = target.startsWith('/') ? [] : ['word'];
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

async function readRelationships(zip: ZipArchive): Promise<Map<string, Relationship>> {
  const doc = await readXml(zip, 'word/_rels/document.xml.rels');
  const rels = new Map<string, Relationship>();
  for (const rel of Array.from(doc?.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship') ?? [])) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target)
      rels.set(id, { target, external: rel.getAttribute('TargetMode') === 'External' });
  }
  return rels;
}

async function readStyles(zip: ZipArchive): Promise<Map<string, StyleInfo>> {
  const doc = await readXml(zip, 'word/styles.xml');
  const styles = new Map<string, StyleInfo>();
  for (const style of Array.from(doc?.getElementsByTagNameNS(W, 'style') ?? [])) {
    const id = wAttr(style, 'styleId');
    if (!id) continue;
    const numPr = child(child(style, 'pPr'), 'numPr');
    const ilvl = wAttr(child(numPr, 'ilvl'), 'val');
    styles.set(id, {
      name: (wAttr(child(style, 'name'), 'val') ?? id).toLowerCase(),
      basedOn: wAttr(child(style, 'basedOn'), 'val') ?? undefined,
      numId: wAttr(child(numPr, 'numId'), 'val') ?? undefined,
      ilvl: ilvl === null ? undefined : Number(ilvl),
    });
  }
  return styles;
}

/** numId → ilvl → numFmt ("decimal", "bullet", "lowerLetter"…). */
async function readNumbering(
  zip: ZipArchive,
): Promise<(numId: string, ilvl: number) => string | null> {
  const doc = await readXml(zip, 'word/numbering.xml');
  const abstracts = new Map<string, Map<number, string>>();
  for (const abstract of Array.from(doc?.getElementsByTagNameNS(W, 'abstractNum') ?? [])) {
    const levels = new Map<number, string>();
    for (const lvl of children(abstract, 'lvl')) {
      levels.set(Number(wAttr(lvl, 'ilvl')), wAttr(child(lvl, 'numFmt'), 'val') ?? 'decimal');
    }
    abstracts.set(wAttr(abstract, 'abstractNumId') ?? '', levels);
  }
  const nums = new Map<string, string>();
  for (const num of Array.from(doc?.getElementsByTagNameNS(W, 'num') ?? [])) {
    nums.set(wAttr(num, 'numId') ?? '', wAttr(child(num, 'abstractNumId'), 'val') ?? '');
  }
  return (numId, ilvl) => abstracts.get(nums.get(numId) ?? '')?.get(ilvl) ?? null;
}

function pictureRelationshipId(element: Element): string | null {
  if (element.localName === 'blip') {
    return element.getAttributeNS(R, 'embed') ?? element.getAttribute('r:embed');
  }
  if (element.localName === 'imagedata') {
    return element.getAttributeNS(R, 'id') ?? element.getAttribute('r:id');
  }
  return null;
}

/** A run's text wrapped in the bold, italic and underline its properties turn on. */
function formatted(nodes: Node[], rPr: Element | undefined): Node[] {
  if (!nodes.some((node) => node.nodeType === Node.TEXT_NODE)) return nodes;
  let wrapped = nodes;
  for (const [flag, tag] of [
    ['b', 'strong'],
    ['i', 'em'],
    ['u', 'u'],
  ] as const) {
    if (!isOn(child(rPr, flag))) continue;
    const element = document.createElement(tag);
    element.append(...wrapped);
    wrapped = [element];
  }
  return wrapped;
}

class DocxReader {
  readonly images: Array<{ img: HTMLImageElement; target: string }> = [];

  constructor(
    private readonly rels: Map<string, Relationship>,
    private readonly styles: Map<string, StyleInfo>,
    private readonly numFormat: (numId: string, ilvl: number) => string | null,
  ) {}

  /** The style and its basedOn ancestors, nearest first. */
  private styleChain(id: string | null): StyleInfo[] {
    const chain: StyleInfo[] = [];
    let next = id;
    while (next && chain.length < 10) {
      const style = this.styles.get(next);
      if (!style) break;
      chain.push(style);
      next = style.basedOn ?? null;
    }
    return chain;
  }

  paragraphInfo(p: Element): ParagraphInfo {
    const pPr = child(p, 'pPr');
    const chain = this.styleChain(wAttr(child(pPr, 'pStyle'), 'val'));
    const name = chain[0]?.name ?? '';
    const headingMatch = /^heading (\d)$/.exec(name);
    let heading: number | null = headingMatch ? Number(headingMatch[1]) : null;
    if (name === 'title') heading = 1;

    const numPr = child(pPr, 'numPr');
    const styledNumbering = chain.find((style) => style.numId);
    const numId = wAttr(child(numPr, 'numId'), 'val') ?? styledNumbering?.numId ?? null;
    const ilvl = Number(wAttr(child(numPr, 'ilvl'), 'val') ?? styledNumbering?.ilvl ?? 0);
    const ind = child(pPr, 'ind');
    const left = Number(wAttr(ind, 'left') ?? wAttr(ind, 'start') ?? 0);
    return {
      heading,
      caption: name === 'caption',
      listStyle: chain.some((style) => style.name.includes('list')),
      numFormat: numId && numId !== '0' ? (this.numFormat(numId, ilvl) ?? 'decimal') : null,
      ilvl,
      indented: left > 0,
    };
  }

  /** The paragraph's runs, links and pictures as inline HTML nodes. */
  inline(container: Element): Node[] {
    const nodes: Node[] = [];
    for (const node of Array.from(container.children)) {
      if (node.localName === 'r') nodes.push(...this.run(node));
      else if (node.localName === 'hyperlink') nodes.push(...this.hyperlink(node));
      else if (['ins', 'smartTag', 'fldSimple', 'customXml'].includes(node.localName)) {
        nodes.push(...this.inline(node));
      } else if (node.localName === 'sdt') {
        const content = child(node, 'sdtContent');
        if (content) nodes.push(...this.inline(content));
      }
    }
    return nodes;
  }

  private hyperlink(link: Element): Node[] {
    const content = this.inline(link);
    const rel = this.rels.get(link.getAttributeNS(R, 'id') ?? link.getAttribute('r:id') ?? '');
    if (!rel?.external) return content;
    const a = document.createElement('a');
    a.setAttribute('href', rel.target);
    a.append(...content);
    return [a];
  }

  private run(run: Element): Node[] {
    const parts = Array.from(run.children).flatMap((part) => this.runPart(part));
    return formatted(parts, child(run, 'rPr'));
  }

  private runPart(part: Element): Node[] {
    switch (part.localName) {
      case 't':
        return [document.createTextNode(part.textContent ?? '')];
      case 'tab':
        return [document.createTextNode(' ')];
      case 'noBreakHyphen':
        return [document.createTextNode('-')];
      case 'cr':
        return [document.createElement('br')];
      case 'br':
        return wAttr(part, 'type') === 'page' ? [] : [document.createElement('br')];
      case 'drawing':
      case 'pict':
        return this.pictures(part);
      default:
        return [];
    }
  }

  /** Images in a drawing (a:blip r:embed) or a legacy VML picture (v:imagedata r:id). */
  private pictures(container: Element): Node[] {
    const ids = Array.from(container.getElementsByTagName('*'))
      .map(pictureRelationshipId)
      .filter((id): id is string => Boolean(id));
    const description = Array.from(container.getElementsByTagName('*'))
      .find((element) => element.localName === 'docPr')
      ?.getAttribute('descr');
    return ids.flatMap((id) => {
      const rel = this.rels.get(id);
      if (!rel || rel.external) return [];
      const img = document.createElement('img');
      img.setAttribute('alt', description?.trim() || 'Guide image');
      this.images.push({ img, target: partPath(rel.target) });
      return [img];
    });
  }
}

/** Longest line kept as a picture's caption when Word puts both in one paragraph. */
const INLINE_CAPTION_MAX_LENGTH = 150;

/** A paragraph that is one picture followed by a short line, as a captioned figure. */
function captionedPicture(holder: HTMLParagraphElement): HTMLElement | null {
  const images = holder.querySelectorAll('img');
  const first = Array.from(holder.childNodes).find(
    (node) =>
      node.nodeName !== 'BR' && (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()),
  );
  const image = images[0];
  if (images.length !== 1 || !image || first !== image) return null;
  image.remove();
  const caption = holder.textContent?.trim() ?? '';
  if (!caption || caption.length > INLINE_CAPTION_MAX_LENGTH) {
    holder.prepend(image);
    return null;
  }
  const figure = document.createElement('figure');
  const figcaption = document.createElement('figcaption');
  figcaption.textContent = caption;
  figure.append(image, figcaption);
  return figure;
}

/** Builds the HTML in document order, keeping a step's follow-on content inside its list item. */
class HtmlBuilder {
  readonly out: Element[] = [];
  private list: HTMLOListElement | null = null;
  private item: HTMLLIElement | null = null;
  private bullets: HTMLUListElement | null = null;
  private lastPicture: Element | null = null;

  constructor(private readonly reader: DocxReader) {}

  /** One body element: a paragraph, a table, or a content control holding paragraphs. */
  add(element: Element): void {
    if (element.localName === 'p') this.paragraph(element);
    else if (element.localName === 'tbl') this.table(element);
    else if (element.localName === 'sdt') {
      const content = child(element, 'sdtContent');
      for (const inner of content ? children(content, 'p') : []) this.paragraph(inner);
    }
  }

  paragraph(p: Element): void {
    const info = this.reader.paragraphInfo(p);
    const holder = document.createElement('p');
    holder.append(...this.reader.inline(p));
    const hasText = Boolean(holder.textContent?.trim());
    const hasPicture = Boolean(holder.querySelector('img'));
    if (!hasText && !hasPicture) return;

    if (this.addCaptioned(holder, info.caption && hasText)) return;
    this.lastPicture = hasPicture && !hasText ? holder : null;

    const numbered = info.numFormat !== null && info.numFormat !== 'bullet';
    if (numbered && info.ilvl === 0 && info.heading === null) this.numberedItem(holder);
    else if (info.numFormat && this.item) this.nested(holder, info.numFormat === 'bullet');
    else if (this.item && (info.indented || info.listStyle || !hasText)) this.item.append(holder);
    else this.block(holder, info);
  }

  /**
   * A caption for the picture just before it, or a picture with its caption on the same line.
   * Returns whether the paragraph was used.
   */
  private addCaptioned(holder: HTMLParagraphElement, isCaption: boolean): boolean {
    if (isCaption && this.lastPicture) {
      this.caption(holder.textContent?.trim() ?? '');
      return true;
    }
    const captioned = captionedPicture(holder);
    if (!captioned) return false;
    this.lastPicture = null;
    if (this.item) this.item.append(captioned);
    else this.push(captioned);
    return true;
  }

  /** A top-level numbered paragraph: the next item of the open list, or a new list. */
  private numberedItem(holder: HTMLParagraphElement): void {
    this.closeBullets();
    this.list ??= this.push(document.createElement('ol'));
    this.item = document.createElement('li');
    this.item.append(...Array.from(holder.childNodes));
    this.list.append(this.item);
    if (this.lastPicture) this.lastPicture = this.item;
  }

  /** Content outside any step: a bullet, a heading or a paragraph. */
  private block(holder: HTMLParagraphElement, info: ParagraphInfo): void {
    this.closeList();
    if (info.numFormat === 'bullet') {
      const li = document.createElement('li');
      li.append(...Array.from(holder.childNodes));
      this.bullets ??= this.push(document.createElement('ul'));
      this.bullets.append(li);
      return;
    }
    this.closeBullets();
    if (info.heading === null) {
      this.push(holder);
      return;
    }
    const heading = document.createElement(`h${Math.min(3, Math.max(1, info.heading))}`);
    heading.append(...Array.from(holder.childNodes));
    this.push(heading);
  }

  table(table: Element): void {
    this.closeList();
    this.closeBullets();
    for (const row of children(table, 'tr')) {
      const cells = children(row, 'tc').map((cell) =>
        children(cell, 'p')
          .map((p) => {
            const holder = document.createElement('span');
            holder.append(...this.reader.inline(p));
            return holder.innerHTML;
          })
          .filter(Boolean)
          .join(' '),
      );
      if (cells.some(Boolean)) {
        const p = document.createElement('p');
        p.innerHTML = cells.join(' | ');
        this.push(p);
      }
    }
  }

  private nested(holder: HTMLParagraphElement, bullet: boolean): void {
    if (!this.item) return;
    if (!bullet) {
      this.item.append(holder);
      return;
    }
    let ul = this.item.lastElementChild;
    if (ul?.tagName !== 'UL') {
      ul = document.createElement('ul');
      this.item.append(ul);
    }
    const li = document.createElement('li');
    li.append(...Array.from(holder.childNodes));
    ul.append(li);
  }

  /** A Caption-styled paragraph names the picture just before it. */
  private caption(text: string): void {
    const picture = this.lastPicture;
    this.lastPicture = null;
    const img = picture?.querySelector('img');
    if (!picture || !img) return;
    const figure = document.createElement('figure');
    const figcaption = document.createElement('figcaption');
    figcaption.textContent = text;
    figure.append(img, figcaption);
    if (picture.tagName === 'LI') picture.append(figure);
    else picture.replaceWith(figure);
    if (this.out.includes(picture)) this.out.splice(this.out.indexOf(picture), 1, figure);
  }

  private push<T extends Element>(element: T): T {
    this.out.push(element);
    return element;
  }

  private closeList(): void {
    this.list = null;
    this.item = null;
  }

  private closeBullets(): void {
    this.bullets = null;
  }
}

async function loadImage(
  zip: ZipArchive,
  target: string,
  prepare: (file: Blob) => Promise<string>,
) {
  const type = IMAGE_TYPES[target.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return null;
  const bytes = await zip.read(target);
  if (!bytes) return null;
  try {
    return await prepare(new Blob([bytes as BlobPart], { type }));
  } catch {
    return null;
  }
}

/** Sets each picture's source from the document's media; returns how many could not be shown. */
async function fillImages(
  zip: ZipArchive,
  images: ReadonlyArray<{ img: HTMLImageElement; target: string }>,
  prepare: (file: Blob) => Promise<string>,
): Promise<number> {
  let skipped = 0;
  const loaded = new Map<string, Promise<string | null>>();
  for (const { img, target } of images) {
    if (!loaded.has(target)) loaded.set(target, loadImage(zip, target, prepare));
    const src = await loaded.get(target);
    if (src) {
      img.setAttribute('src', src);
    } else {
      skipped += 1;
      removePicture(img);
    }
  }
  return skipped;
}

/** Removes a picture that cannot be shown; a caption left without it becomes a paragraph. */
function removePicture(img: HTMLImageElement): void {
  const holder = img.parentElement;
  img.remove();
  if (holder?.localName === 'figure') {
    const caption = holder.querySelector('figcaption')?.textContent?.trim();
    const paragraph = document.createElement('p');
    paragraph.textContent = caption ?? '';
    if (caption) holder.replaceWith(paragraph);
    else holder.remove();
  } else if (
    holder?.localName === 'p' &&
    !holder.textContent?.trim() &&
    !holder.querySelector('img')
  ) {
    holder.remove();
  }
}

/**
 * The document's body as HTML, pictures resized by `prepareImage`. Pictures in formats a browser
 * cannot show (EMF, WMF, SVG) are left out and counted.
 */
export async function docxToHtml(
  file: Blob,
  prepareImage: (file: Blob) => Promise<string>,
): Promise<DocxImport> {
  const zip = await openZip(file);
  const document_ = await readXml(zip, 'word/document.xml');
  const body = document_?.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('This is not a Word document.');

  const reader = new DocxReader(
    await readRelationships(zip),
    await readStyles(zip),
    await readNumbering(zip),
  );
  const builder = new HtmlBuilder(reader);
  for (const element of Array.from(body.children)) builder.add(element);
  const container = document.createElement('div');
  container.append(...builder.out);
  const skippedImages = await fillImages(zip, reader.images, prepareImage);
  return { html: container.innerHTML, skippedImages };
}
