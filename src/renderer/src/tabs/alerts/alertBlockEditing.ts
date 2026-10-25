/**
 * DOM operations the alert body editor performs on guide blocks. Kept free of React so they can
 * be tested against a plain element; every caller emits the result through the editor's normal
 * change path.
 */

const TRAILING_PARAGRAPH = '<p><br></p>';

function htmlToElements(html: string): Element[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.children);
}

/** A line with no text and no image, such as the `<p><br></p>` an Enter leaves behind. */
function isEmptyLine(element: Element): boolean {
  return (
    element.tagName === 'P' &&
    !element.hasAttribute('data-relay-block') &&
    !element.textContent?.trim() &&
    !element.querySelector('img')
  );
}

/** The direct child of `root` that contains `node`, or null when `node` is not inside `root`. */
export function topLevelBlockOf(root: HTMLElement, node: Node | null): Element | null {
  let current = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  return current instanceof Element ? current : null;
}

/**
 * Insert a block after `anchor` (a direct child of `root`), or at the end when there is none. An
 * empty anchor line is replaced instead, and a block that ends the body gets a paragraph after it
 * so typing can continue below.
 */
export function insertBlockAfter(root: HTMLElement, anchor: Element | null, html: string): Element {
  const [block] = htmlToElements(html);
  if (!block) throw new Error('No block to insert.');
  if (anchor && isEmptyLine(anchor)) anchor.replaceWith(block);
  else if (anchor) anchor.after(block);
  else root.append(block);
  if (!block.nextSibling) block.after(...htmlToElements(TRAILING_PARAGRAPH));
  return block;
}

/**
 * Put a captioned figure inside a step, after the step child holding the caret. A figure that ends
 * the step gets a paragraph after it so the step can continue below the image.
 */
export function insertFigureInStep(step: Element, after: Node | null, figureHtml: string): void {
  let child = after;
  while (child && child.parentNode !== step) child = child.parentNode;
  const elements = htmlToElements(figureHtml);
  if (child instanceof Element && child.tagName !== 'H3') child.after(...elements);
  else step.append(...elements);
  const last = elements.at(-1);
  if (last && !last.nextElementSibling) step.append(...htmlToElements(TRAILING_PARAGRAPH));
}

/**
 * Place the caret at the start of a block's first field: a step's title, a callout's text. A
 * divider or button has no field, so the caret goes to the line after it.
 */
export function focusFirstField(block: Element, selection: Selection): void {
  const hasNoField = block.matches('hr, [data-relay-block="button"]');
  const target = (hasNoField ? block.nextElementSibling : null) ?? block;
  const field = target.querySelector('h3, p, li') ?? target;
  const range = document.createRange();
  range.setStart(field, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
