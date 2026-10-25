import { beforeEach, describe, expect, it } from 'vitest';
import { calloutBlockHtml, stepBlockHtml } from '../alertBlocks';
import {
  focusFirstField,
  insertBlockAfter,
  insertFigureInStep,
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

  it('moves the caret into the first editable field of a block', () => {
    root.innerHTML = `${stepBlockHtml()}${calloutBlockHtml('note')}`;
    const selection = globalThis.getSelection()!;

    focusFirstField(root.children[0]!, selection);
    expect(selection.anchorNode).toBe(root.querySelector('h3'));

    focusFirstField(root.children[1]!, selection);
    expect(selection.anchorNode).toBe(root.querySelector('[data-relay-block="callout"] p'));
  });
});
