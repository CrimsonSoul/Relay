import { beforeEach, describe, expect, it } from 'vitest';
import { calloutBlockHtml, stepBlockHtml } from '../alertBlocks';
import {
  focusFirstField,
  insertBlockAfter,
  insertFigureInStep,
  moveStep,
  removeBlock,
  stepNumberOf,
  topLevelBlockOf,
} from '../alertBlockEditing';

const FIGURE =
  '<figure class="alert-body-figure"><img src="data:image/png;base64,QQ==" alt="Alert image"><figcaption></figcaption></figure>';

describe('alertBlockEditing', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('finds the top-level element that contains a node', () => {
    root.innerHTML = `<p>Intro</p>${stepBlockHtml('Open', '<p>Go <b>now</b></p>')}`;
    const bold = root.querySelector('b')!.firstChild!;
    expect(topLevelBlockOf(root, bold)).toBe(root.querySelector('[data-relay-block="step"]'));
    expect(topLevelBlockOf(root, root)).toBeNull();
    expect(topLevelBlockOf(root, document.body)).toBeNull();
    expect(topLevelBlockOf(root, null)).toBeNull();
  });

  it('inserts after the top-level block holding the caret instead of inside it', () => {
    root.innerHTML = `${stepBlockHtml('Open', '<p>Go</p>')}<p>After</p>`;
    const caretParagraph = root.querySelector('[data-relay-block="step"] p')!;
    const anchor = topLevelBlockOf(root, caretParagraph.firstChild);

    const inserted = insertBlockAfter(root, anchor, calloutBlockHtml('note'));

    expect(inserted.parentElement).toBe(root);
    expect(root.children[1]).toBe(inserted);
    expect(root.querySelector('[data-relay-block="step"] [data-relay-block]')).toBeNull();
  });

  it('appends to an empty body and leaves a paragraph to keep typing in', () => {
    const inserted = insertBlockAfter(root, null, stepBlockHtml());
    expect(root.firstElementChild).toBe(inserted);
    expect(root.innerHTML).toBe(`${stepBlockHtml()}<p><br></p>`);
  });

  it('replaces the empty line the caret is on', () => {
    root.innerHTML = '<p>Intro</p><p><br></p><p>Outro</p>';
    const inserted = insertBlockAfter(root, root.children[1]!, calloutBlockHtml('warning'));
    expect(root.innerHTML).toBe(`<p>Intro</p>${calloutBlockHtml('warning')}<p>Outro</p>`);
    expect(inserted.getAttribute('data-tone')).toBe('warning');
  });

  it('replaces the bare empty div Chromium leaves in a cleared body, but not a filled div', () => {
    root.innerHTML = '<div><br></div>';
    insertBlockAfter(root, root.children[0]!, stepBlockHtml('First'));
    expect(root.innerHTML).toBe(`${stepBlockHtml('First')}<p><br></p>`);

    root.innerHTML = '<div>Kept</div>';
    insertBlockAfter(root, root.children[0]!, stepBlockHtml('Next'));
    expect(root.innerHTML).toBe(`<div>Kept</div>${stepBlockHtml('Next')}<p><br></p>`);
  });

  it('puts a figure inside a step after the caret paragraph', () => {
    root.innerHTML = stepBlockHtml('Sign in', '<p>First</p><p>Second</p>');
    const step = root.firstElementChild!;
    insertFigureInStep(step, step.querySelector('p')!.firstChild, FIGURE);
    expect(Array.from(step.children, (child) => child.tagName)).toEqual(['H3', 'P', 'FIGURE', 'P']);
    expect(step.children[3]!.textContent).toBe('Second');
  });

  it('appends a figure and a fresh line to a step when the caret is on its title', () => {
    root.innerHTML = stepBlockHtml('Sign in', '<p>First</p>');
    const step = root.firstElementChild!;
    insertFigureInStep(step, step.querySelector('h3')!.firstChild, FIGURE);
    expect(Array.from(step.children, (child) => child.tagName)).toEqual(['H3', 'P', 'FIGURE', 'P']);
    expect(step.lastElementChild!.innerHTML).toBe('<br>');
  });

  it('numbers steps among top-level steps only', () => {
    root.innerHTML = `<p>Intro</p>${stepBlockHtml('A')}<h2>X</h2>${stepBlockHtml('B')}`;
    const steps = root.querySelectorAll('[data-relay-block="step"]');
    expect(stepNumberOf(root, steps[0]!)).toBe(1);
    expect(stepNumberOf(root, steps[1]!)).toBe(2);
  });

  it('moveStep swaps with the nearest step and leaves other content in place', () => {
    root.innerHTML = `${stepBlockHtml('A')}<h2>X</h2>${stepBlockHtml('B')}`;
    const stepB = root.querySelectorAll('[data-relay-block="step"]')[1]!;

    expect(moveStep(root, stepB, 'up')).toEqual({ from: 2, to: 1 });
    expect(root.innerHTML).toBe(`${stepBlockHtml('B')}<h2>X</h2>${stepBlockHtml('A')}`);

    expect(moveStep(root, stepB, 'down')).toEqual({ from: 1, to: 2 });
    expect(root.innerHTML).toBe(`${stepBlockHtml('A')}<h2>X</h2>${stepBlockHtml('B')}`);
  });

  it('moveStep returns null at the ends', () => {
    root.innerHTML = `${stepBlockHtml('A')}${stepBlockHtml('B')}`;
    const [first, last] = Array.from(root.children);
    expect(moveStep(root, first!, 'up')).toBeNull();
    expect(moveStep(root, last!, 'down')).toBeNull();
    expect(root.innerHTML).toBe(`${stepBlockHtml('A')}${stepBlockHtml('B')}`);
  });

  it('removes a block and leaves the rest', () => {
    root.innerHTML = `<p>Intro</p>${calloutBlockHtml('note')}<p>Outro</p>`;
    const outro = root.children[2];
    expect(removeBlock(root.children[1]!)).toBe(outro);
    expect(root.innerHTML).toBe('<p>Intro</p><p>Outro</p>');
  });

  it('moves the caret into the first editable field of a block', () => {
    root.innerHTML = `${stepBlockHtml()}${calloutBlockHtml('note')}`;
    const selection = globalThis.getSelection()!;

    focusFirstField(root.children[0]!, selection);
    expect(selection.anchorNode).toBe(root.querySelector('h3'));

    focusFirstField(root.children[1]!, selection);
    expect(selection.anchorNode).toBe(root.querySelector('[data-relay-block="callout"] p'));
  });
});
