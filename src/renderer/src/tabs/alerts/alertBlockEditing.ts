/**
 * DOM operations the alert body editor performs on guide blocks. Kept free of React so they can
 * be tested against a plain element; every caller emits the result through the editor's normal
 * change path.
 */

import { elementDataset } from './alertBlocks';

const TRAILING_PARAGRAPH = '<p><br></p>';

function htmlToElements(html: string): Element[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.children);
}

/** An empty paragraph, or the bare `<div><br></div>` Chromium leaves when the body is cleared. */
function isEmptyLine(element: Element): boolean {
  return (
    (element.tagName === 'P' || element.tagName === 'DIV') &&
    elementDataset(element)?.relayBlock === undefined &&
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

function topLevelSteps(root: HTMLElement): Element[] {
  return Array.from(root.children).filter((child) => elementDataset(child)?.relayBlock === 'step');
}

/** The step's 1-based position among the body's steps, as the preview numbers it. */
export function stepNumberOf(root: HTMLElement, step: Element): number {
  return topLevelSteps(root).indexOf(step) + 1;
}

/**
 * Swap a step with the nearest step above or below it. Content between the two stays where it
 * is. Returns the step's old and new numbers, or null when it is already first or last.
 */
export function moveStep(
  root: HTMLElement,
  step: Element,
  direction: 'up' | 'down',
): { from: number; to: number } | null {
  const steps = topLevelSteps(root);
  const index = steps.indexOf(step);
  const other = steps[direction === 'up' ? index - 1 : index + 1];
  if (index < 0 || !other) return null;
  const marker = document.createComment('');
  step.replaceWith(marker);
  other.replaceWith(step);
  marker.replaceWith(other);
  return { from: index + 1, to: steps.indexOf(other) + 1 };
}

/** Remove a block; returns the neighbour that should take the caret, if any. */
export function removeBlock(block: Element): Element | null {
  const neighbour = block.nextElementSibling ?? block.previousElementSibling;
  block.remove();
  return neighbour;
}

/** True when a step or callout holds no text and no image, so Backspace may remove it. */
export function isEmptyBlock(block: Element): boolean {
  return !block.textContent?.trim() && !block.querySelector('img');
}
