import { describe, expect, it } from 'vitest';
import { guideBlocksFromPaste } from '../pasteToGuide';
import { buttonBlockHtml, calloutBlockHtml, stepBlockHtml } from '../alertBlocks';

const nbsp = '\u00a0';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const figure = (alt: string, caption = '') =>
  `<figure class="alert-body-figure"><img src="${PNG}" alt="${alt}" class="alert-body-image">` +
  `<figcaption>${caption}</figcaption></figure>`;

/** Windows Word's clipboard: list numbers are text inside conditional comments, not an <ol>. */
function wordListParagraph(number: number, html: string): string {
  return (
    `<p class=MsoListParagraphCxSpMiddle style='mso-list:l0 level1 lfo1'><![if !supportLists]>` +
    `<span style='mso-list:Ignore'>${number}.<span style='font:7.0pt "Times New Roman"'>` +
    `${nbsp.repeat(5)} </span></span><![endif]>${html}<o:p></o:p></p>`
  );
}

describe('guideBlocksFromPaste', () => {
  it('turns a Word numbered list into steps and keeps the intro as text', () => {
    const html =
      `<div class=WordSection1><p class=MsoNormal>Connect to the VPN before you start.</p>` +
      wordListParagraph(1, 'Open the <b>GlobalProtect</b> client') +
      wordListParagraph(2, 'Choose the Corp portal') +
      `</div>`;

    expect(guideBlocksFromPaste(html, '')).toBe(
      '<p>Connect to the VPN before you start.</p>' +
        stepBlockHtml('Open the GlobalProtect client') +
        stepBlockHtml('Choose the Corp portal'),
    );
  });

  it('uses a list item’s bold lead-in as the title and the rest as the body', () => {
    const html =
      '<ol><li><strong>Open Settings.</strong> Choose <em>Network</em> in the sidebar.</li></ol>';

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml('Open Settings', '<p>Choose <em>Network</em> in the sidebar.</p>'),
    );
  });

  it('gives each "Step N" heading the content up to the next heading', () => {
    const html =
      '<h1>Reset MFA</h1><h3>Step 1: Sign in</h3><p>Use your admin account.</p>' +
      '<ul><li>Not your daily account</li></ul><h3>Step 2 - Find the user</h3><p>Search by email.</p>' +
      '<h2>Background</h2><p>Why this matters.</p>';

    expect(guideBlocksFromPaste(html, '')).toBe(
      '<h2>Reset MFA</h2>' +
        stepBlockHtml(
          'Sign in',
          '<p>Use your admin account.</p><ul><li>Not your daily account</li></ul>',
        ) +
        stepBlockHtml('Find the user', '<p>Search by email.</p>') +
        '<h2>Background</h2><p>Why this matters.</p>',
    );
  });

  it('splits a numbered line of several sentences at its first sentence', () => {
    const rest =
      'The setting is under Advanced, and it can take a few minutes to appear for everyone in the tenant.';
    const html = `<ol><li>Turn on the policy. ${rest}</li></ol>`;

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml('Turn on the policy.', `<p>${rest}</p>`),
    );
  });

  it('wraps labelled paragraphs in callouts of the matching tone, label kept', () => {
    const html =
      '<p><b>Warning:</b> This signs everyone out.</p><p>Note - takes 5 minutes.</p>' +
      '<p>Result: the user can sign in.</p>';

    expect(guideBlocksFromPaste(html, '')).toBe(
      calloutBlockHtml('warning', '<p><b>Warning:</b> This signs everyone out.</p>') +
        calloutBlockHtml('note', '<p>Note - takes 5 minutes.</p>') +
        calloutBlockHtml('success', '<p>Result: the user can sign in.</p>'),
    );
  });

  it('turns a lone link into a button and leaves links inside sentences alone', () => {
    const html =
      '<p><a href="https://portal.example.com/">Open the portal</a></p>' +
      '<p>See <a href="https://wiki.example.com/">the wiki</a> for more.</p>';

    expect(guideBlocksFromPaste(html, '')).toBe(
      buttonBlockHtml('https://portal.example.com/', 'Open the portal') +
        '<p>See <a href="https://wiki.example.com/">the wiki</a> for more.</p>',
    );
  });

  it('converts plain text by its lines', () => {
    const plain = 'Before you begin\n1. Open Outlook\n2) Choose File\nTip: restart if it hangs.';

    expect(guideBlocksFromPaste('', plain)).toBe(
      '<p>Before you begin</p>' +
        stepBlockHtml('Open Outlook') +
        stepBlockHtml('Choose File') +
        calloutBlockHtml('note', '<p>Tip: restart if it hangs.</p>'),
    );
  });

  it('returns null when the paste has no guide shape', () => {
    expect(
      guideBlocksFromPaste('<p>Just a sentence.</p><ul><li>A bullet</li></ul>', ''),
    ).toBeNull();
    expect(guideBlocksFromPaste('', 'Plain words only')).toBeNull();
    expect(guideBlocksFromPaste('<h2>Step up your game</h2>', '')).toBeNull();
  });

  it('keeps the sanitizer’s rules: no scripts, styles, unsafe links or foreign block markers', () => {
    const html =
      '<style>p.MsoNormal { margin: 0 }</style><ol><li>Click <a href="javascript:alert(1)">here</a><script>alert(1)</script></li></ol>' +
      '<p><a href="javascript:alert(2)">Run it</a></p>' +
      '<div data-relay-block="callout" data-tone="warning"><p>Imported marker</p></div>';

    const result = guideBlocksFromPaste(html, '') ?? '';

    expect(result).toBe(stepBlockHtml('Click here') + '<p>Run it</p><p>Imported marker</p>');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<script');
  });
  it('keeps a list item’s screenshot in its step, below the text', () => {
    const html = `<ol><li>Search for the user.<br><img src="${PNG}" alt="User search"></li><li>Open the profile.</li></ol>`;

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml('Search for the user.', figure('User search')) +
        stepBlockHtml('Open the profile.'),
    );
  });

  it('gives a captioned picture right after a list to the list’s last step, caption kept', () => {
    const html =
      `<ol><li>Select Require re-register MFA.</li></ol>` +
      `<figure><img src="${PNG}" alt="Methods"><figcaption>It is under the list.</figcaption></figure>` +
      `<p><img src="${PNG}" alt="Second"></p><p>After the pictures.</p><p><img src="${PNG}" alt="Alone"></p>`;

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml(
        'Select Require re-register MFA.',
        figure('Methods', 'It is under the list.') + figure('Second'),
      ) +
        '<p>After the pictures.</p>' +
        figure('Alone'),
    );
  });

  it('puts a picture under a "Step N" heading into that step', () => {
    const html = `<h2>Step 3: Sign in</h2><p>Approve the prompt.</p><p><img src="${PNG}" alt="Ready"></p>`;

    expect(guideBlocksFromPaste(html, '')).toBe(
      stepBlockHtml('Sign in', `<p>Approve the prompt.</p>${figure('Ready')}`),
    );
  });
});
