import { sanitizeHtml } from '../alertUtils';
import {
  ALERT_BUTTON_LABEL_MAX_LENGTH,
  buttonBlockHtml,
  calloutBlockHtml,
  sanitizeHttpHref,
  stepBlockHtml,
  stripBlockMarkers,
  type AlertCalloutTone,
} from './alertBlocks';

/*
 * Smart paste: a guide copied from Word, Outlook, Confluence or a web page arrives as headings,
 * numbered lists and "Note:" paragraphs. This turns that shape into guide blocks: numbered items
 * and "Step N" headings become steps, labelled paragraphs become callouts, and a link alone on its
 * line becomes a button. Everything else is kept as ordinary content.
 */

/** "1. ", "2) ", "Step 3: ", "Step 4 - " (Word writes list numbers as text; `\s` covers its no-break spaces). */
const NUMBERED_PREFIX = /^\s*(?:step\s*)?\d{1,2}\s*[.):\-–—]\s*/i;
const STEP_HEADING_PREFIX = /^\s*step\s*\d{1,2}\b\s*[.):\-–—]?\s*/i;
const CALLOUT_LABELS: ReadonlyArray<{ tone: AlertCalloutTone; pattern: RegExp }> = [
  { tone: 'warning', pattern: /^\s*(?:warning|caution|danger|attention)\s*[:!\-–—]/i },
  { tone: 'success', pattern: /^\s*(?:success|result|expected result|done)\s*[:\-–—]/i },
  { tone: 'note', pattern: /^\s*(?:note|important|info|tip|heads up)\s*[:\-–—]/i },
];
/** A one-sentence numbered line up to this long is the step's title; a longer one is its body. */
const STEP_TITLE_MAX_LENGTH = 120;
const SOURCE_HEADINGS = 'h1, h3, h4, h5, h6';
/** Word and web clipboards carry stylesheets and scripts whose text is not part of the guide. */
const NON_CONTENT = 'script, style, meta, link, title, noscript, template, xml';

/** Whether a line opens a step or callout of its own ("1.", "Step 2", "Note:"). */
export function startsGuideBlock(text: string): boolean {
  return (
    NUMBERED_PREFIX.test(text) ||
    STEP_HEADING_PREFIX.test(text) ||
    CALLOUT_LABELS.some(({ pattern }) => pattern.test(text))
  );
}

type GuidePiece = { kind: 'step'; title: string; body: Node[] } | { kind: 'html'; html: string };

const textOf = (node: Node) => (node.textContent ?? '').replaceAll(/\s+/g, ' ').trim();

const outerHtml = (node: Node): string => {
  if (node instanceof Element) return node.outerHTML;
  const text = textOf(node);
  if (!text) return '';
  const p = document.createElement('p');
  p.textContent = text;
  return p.outerHTML;
};

/** Removes `pattern`'s match from the start of `element`'s text, keeping the formatting after it. */
function stripLeadingText(element: Element, pattern: RegExp): void {
  let remaining = pattern.exec(element.textContent ?? '')?.[0].length ?? 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (remaining > 0 && walker.nextNode()) {
    const text = walker.currentNode as Text;
    const cut = Math.min(remaining, text.data.length);
    text.data = text.data.slice(cut);
    remaining -= cut;
  }
  // A bold "Step 2:" leaves an empty <strong> behind.
  for (const inline of Array.from(element.querySelectorAll('strong, b, em, i, u, span'))) {
    if (!inline.textContent && !inline.querySelector('img')) inline.remove();
  }
}

/** Top-level content with wrapper divs (Word's WordSection1, Confluence's layout) opened up. */
function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => {
    if (node instanceof Element && node.tagName === 'DIV')
      return flatten(Array.from(node.childNodes));
    if (node.nodeType === Node.TEXT_NODE && !textOf(node)) return [];
    return [node];
  });
}

function calloutToneOf(node: Node): AlertCalloutTone | null {
  if (!(node instanceof Element) || node.tagName !== 'P') return null;
  const text = node.textContent ?? '';
  return CALLOUT_LABELS.find(({ pattern }) => pattern.test(text))?.tone ?? null;
}

/** A paragraph that is one http(s) link with a button-sized label. */
function buttonOf(node: Node): string | null {
  if (!(node instanceof Element) || node.tagName !== 'P') return null;
  const links = node.querySelectorAll('a');
  const link = links[0];
  if (links.length !== 1 || !link || textOf(link) !== textOf(node)) return null;
  const href = sanitizeHttpHref(link.getAttribute('href') ?? '');
  const label = textOf(link);
  if (!href || !label || label.length > ALERT_BUTTON_LABEL_MAX_LENGTH) return null;
  return buttonBlockHtml(href, label);
}

/** "Open Settings:" or "Open Settings." as a title: "Open Settings". */
function withoutTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && ':. '.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** A pasted picture as the editor's own captioned figure, so it sizes and captions like one. */
function figureFor(image: Element, caption = ''): Element {
  const figure = document.createElement('figure');
  figure.className = 'alert-body-figure';
  const img = image.cloneNode() as Element;
  img.setAttribute('class', 'alert-body-image');
  const figcaption = document.createElement('figcaption');
  figcaption.textContent = caption;
  figure.append(img, figcaption);
  return figure;
}

/** `node` as figures when it is only pictures (a figure, an image, a paragraph of images). */
function picturesOf(node: Node): Element[] | null {
  if (!(node instanceof Element)) return null;
  if (node.tagName === 'IMG') return [figureFor(node)];
  if (node.tagName === 'FIGURE') {
    const img = node.querySelector('img');
    const caption = node.querySelector('figcaption');
    return img ? [figureFor(img, caption ? textOf(caption) : '')] : null;
  }
  if (node.tagName !== 'P' || textOf(node)) return null;
  const images = Array.from(node.querySelectorAll('img'));
  return images.length > 0 ? images.map((img) => figureFor(img)) : null;
}

/** Moves a list item's screenshots out of its text and returns them as figures for its body. */
function takePictures(item: Element): Element[] {
  const figures: Element[] = [];
  for (const element of Array.from(item.querySelectorAll('figure, img'))) {
    if (element.tagName === 'IMG' && element.closest('figure')) continue;
    figures.push(...(picturesOf(element) ?? []));
    element.remove();
  }
  // The line break Word and browsers put between the text and its picture.
  while (item.lastChild && (item.lastChild.nodeName === 'BR' || !textOf(item.lastChild))) {
    if (item.lastChild instanceof Element && item.lastChild.querySelector('img')) break;
    item.lastChild.remove();
  }
  for (const empty of Array.from(item.querySelectorAll('p'))) {
    if (!textOf(empty) && !empty.querySelector('img')) empty.remove();
  }
  return figures;
}

/** A step from a numbered paragraph or list item: its title, and its body with any pictures. */
function stepFromLine(line: Element): { title: string; body: Node[] } {
  const item = line.cloneNode(true) as Element;
  stripLeadingText(item, NUMBERED_PREFIX);
  const pictures = takePictures(item);
  const { title, body } = stepTextFromLine(item);
  return { title, body: [...body, ...pictures] };
}

const BLOCK_TAGS = /^(P|UL|OL|FIGURE|DIV|H[1-6]|BLOCKQUOTE)$/;

/**
 * A step's title and body from a list item: its leading line of text gives the title (and any
 * rest of that line), and paragraphs, lists or pictures after it join the body in order.
 */
function stepTextFromLine(item: Element): { title: string; body: Node[] } {
  const nodes = Array.from(item.childNodes);
  const split = nodes.findIndex((node) => node instanceof Element && BLOCK_TAGS.test(node.tagName));
  const lead = document.createElement('p');
  lead.append(...(split === -1 ? nodes : nodes.slice(0, split)));
  const blocks = split === -1 ? [] : nodes.slice(split);

  // No line of text before the blocks: a first paragraph is the title.
  if (!textOf(lead)) {
    const first = blocks[0];
    if (first instanceof Element && first.tagName === 'P' && textOf(first)) {
      return { title: textOf(first), body: blocks.slice(1) };
    }
    return { title: '', body: blocks };
  }
  const { title, body } = titleFromLine(lead);
  return { title, body: [...body, ...blocks] };
}

/** One line of a step: a bold lead-in or first sentence is the title, the rest its body. */
function titleFromLine(line: Element): { title: string; body: Node[] } {
  const lead = line.firstChild;
  if (
    lead instanceof Element &&
    /^(STRONG|B)$/.test(lead.tagName) &&
    textOf(lead).length < textOf(line).length
  ) {
    lead.remove();
    stripLeadingText(line, /^\s+/);
    return { title: withoutTrailingPunctuation(textOf(lead)), body: [paragraphOf(line)] };
  }

  const text = textOf(line);
  const end = text.search(/[.!?]\s/);
  if (end > 0) {
    const rest = document.createTextNode(text.slice(end + 2));
    return { title: text.slice(0, end + 1), body: [paragraphOf(rest)] };
  }
  if (text.length <= STEP_TITLE_MAX_LENGTH) return { title: text, body: [] };
  return { title: '', body: [paragraphOf(line)] };
}

/** `node`'s inline content as one paragraph (list items and plain text alike). */
function paragraphOf(node: Node): Element {
  const p = document.createElement('p');
  if (node instanceof Element) p.append(...Array.from(node.childNodes));
  else p.append(node);
  return p;
}

function isNumberedParagraph(node: Node): node is Element {
  return (
    node instanceof Element && node.tagName === 'P' && NUMBERED_PREFIX.test(node.textContent ?? '')
  );
}

function isStepHeading(node: Node): node is Element {
  return (
    node instanceof Element &&
    node.tagName === 'H2' &&
    STEP_HEADING_PREFIX.test(node.textContent ?? '')
  );
}

type StepPiece = Extract<GuidePiece, { kind: 'step' }>;

/** The steps `node` starts: a "Step N" heading, a numbered paragraph, or each item of a list. */
function stepsOf(node: Node): Array<{ title: string; body: Node[] }> | null {
  if (isStepHeading(node)) {
    const heading = node.cloneNode(true) as Element;
    stripLeadingText(heading, STEP_HEADING_PREFIX);
    return [{ title: textOf(heading), body: [] }];
  }
  if (isNumberedParagraph(node)) return [stepFromLine(node)];
  if (node instanceof Element && node.tagName === 'OL') {
    return Array.from(node.children)
      .filter((child) => child.tagName === 'LI')
      .map((item) => stepFromLine(item));
  }
  return null;
}

/** Content that ends a step and stands on its own: a callout, a button, a heading or a rule. */
function standaloneHtml(node: Node): string | null {
  const tone = calloutToneOf(node);
  if (tone) return calloutBlockHtml(tone, outerHtml(node));
  const button = buttonOf(node);
  if (button) return button;
  if (node instanceof Element && /^(H2|HR)$/.test(node.tagName)) return outerHtml(node);
  return null;
}

/** Walks the pasted content in order, deciding where each node goes. */
class GuideBuilder {
  readonly pieces: GuidePiece[] = [];
  private step: StepPiece | null = null;
  /** The last step of a list just closed: a picture right after it still illustrates that step. */
  private listStep: StepPiece | null = null;

  add(node: Node): void {
    const pictures = picturesOf(node);
    const owner = this.step ?? this.listStep;
    this.listStep = null;
    if (pictures && owner) {
      owner.body.push(...pictures);
      if (!this.step) this.listStep = owner;
      return;
    }
    const steps = stepsOf(node);
    if (steps) {
      this.addSteps(steps, node instanceof Element && node.tagName === 'OL');
      return;
    }
    const standalone = standaloneHtml(node) ?? pictures?.map(outerHtml).join('') ?? null;
    if (standalone === null && this.step) this.step.body.push(node);
    else this.addHtml(standalone ?? outerHtml(node));
  }

  private addSteps(steps: Array<{ title: string; body: Node[] }>, fromList: boolean): void {
    for (const { title, body } of steps) {
      this.step = { kind: 'step', title, body };
      this.pieces.push(this.step);
    }
    // A list ends with its last item; only a picture right after it joins that step.
    if (fromList) {
      this.listStep = this.step;
      this.step = null;
    }
  }

  private addHtml(html: string): void {
    this.step = null;
    if (html) this.pieces.push({ kind: 'html', html });
  }
}

function toPieces(nodes: Node[]): GuidePiece[] {
  const builder = new GuideBuilder();
  for (const node of nodes) builder.add(node);
  return builder.pieces;
}

function plainTextAsHtml(plain: string): string {
  return plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p.outerHTML;
    })
    .join('');
}

/**
 * Guide blocks for a paste from outside Relay, sanitized and ready to insert, or null when the
 * paste has no guide shape (no numbered steps, labelled notes or lone links) to convert.
 */
export function guideBlocksFromPaste(html: string, plain: string): string | null {
  const template = document.createElement('template');
  template.innerHTML = html.trim() ? stripBlockMarkers(html) : plainTextAsHtml(plain);
  for (const element of Array.from(template.content.querySelectorAll(NON_CONTENT))) {
    element.remove();
  }
  // The sanitizer drops h1 and turns h3 into bold text; a source heading is a guide heading here.
  for (const heading of Array.from(template.content.querySelectorAll(SOURCE_HEADINGS))) {
    const h2 = document.createElement('h2');
    h2.append(...Array.from(heading.childNodes));
    heading.replaceWith(h2);
  }

  const clean = document.createElement('template');
  clean.innerHTML = sanitizeHtml(template.innerHTML);
  const pieces = toPieces(flatten(Array.from(clean.content.childNodes)));
  const hasBlock = pieces.some(
    (piece) => piece.kind === 'step' || piece.html.includes('data-relay-block'),
  );
  if (!hasBlock) return null;

  const guideHtml = pieces
    .map((piece) =>
      piece.kind === 'html'
        ? piece.html
        : stepBlockHtml(piece.title, piece.body.map(outerHtml).join('') || undefined),
    )
    .join('');
  return sanitizeHtml(guideHtml);
}
