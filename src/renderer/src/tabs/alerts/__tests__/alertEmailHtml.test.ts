import { describe, expect, it } from 'vitest';
import {
  alertCalloutTonesIn,
  buildAlertEmailHtml,
  buildAlertEmailText,
  readImageSize,
  type AlertEmailHtmlInput,
} from '../alertEmailHtml';
import { buttonBlockHtml, calloutBlockHtml, dividerBlockHtml, stepBlockHtml } from '../alertBlocks';

// 1×1 and 2×3 PNGs; the IHDR header is all readImageSize needs.
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_2X3 = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3, 8, 6, 0, 0, 0,
]).toString('base64')}`;

const figure = (src: string, caption = '') =>
  `<figure class="alert-body-figure"><img src="${src}" alt="Step" class="alert-body-image"><figcaption>${caption}</figcaption></figure>`;

function input(overrides: Partial<AlertEmailHtmlInput> = {}): AlertEmailHtmlInput {
  return {
    severity: 'ISSUE',
    subject: 'VPN outage',
    sender: 'IT Service Desk',
    recipient: 'All Employees',
    bodyHtml: '<p>Reconnect after 5 minutes.</p>',
    assets: { iconStripDataUrl: PNG_1X1 },
    ...overrides,
  };
}

describe('buildAlertEmailHtml', () => {
  it('renders a 640px table card with inline styles only', () => {
    const { html } = buildAlertEmailHtml(input());
    expect(html).toContain('width="640"');
    expect(html).not.toMatch(/class=|<svg|position:/i);
    expect(html).toContain('bgcolor="#d32f2f"');
    expect(html).toContain('VPN outage');
    expect(html).toContain('IT Service Desk');
    expect(html).toContain('Reconnect after 5 minutes.');
  });

  it('references each body image by CID in document order', () => {
    const { html, inlineImages } = buildAlertEmailHtml(
      input({ bodyHtml: `<p>One</p>${figure(PNG_1X1)}<p>Two</p>${figure(PNG_2X3)}` }),
    );
    expect(inlineImages.map((image) => image.cid)).toEqual([
      'relay-alert-icon',
      'relay-alert-body-0',
      'relay-alert-body-1',
    ]);
    expect(inlineImages[2]).toMatchObject({ dataUrl: PNG_2X3, fileName: 'image-1.png' });
    expect(html).toContain('src="cid:relay-alert-body-1" width="2" height="3"');
    expect(html).not.toContain('data:image');
  });

  it('adds logo CIDs only when logos are set', () => {
    const withLogos = buildAlertEmailHtml(
      input({
        assets: { iconStripDataUrl: PNG_1X1, logoDataUrl: PNG_2X3, footerLogoDataUrl: PNG_1X1 },
      }),
    );
    expect(withLogos.inlineImages.map((image) => image.cid)).toEqual([
      'relay-alert-icon',
      'relay-alert-logo',
      'relay-alert-footer-logo',
    ]);
    expect(withLogos.html).toContain('src="cid:relay-alert-logo"');
    expect(withLogos.html).toContain('src="cid:relay-alert-footer-logo"');

    const plain = buildAlertEmailHtml(input());
    expect(plain.html).not.toContain('relay-alert-logo');
    expect(plain.html).not.toContain('relay-alert-footer-logo');
  });

  it('maps highlights, headings and captions to inline styles', () => {
    const { html } = buildAlertEmailHtml(
      input({
        bodyHtml: `<h2>Step 1</h2><p><span data-hl="warning">Do not restart</span></p>${figure(PNG_1X1, 'Click Save')}${figure(PNG_1X1)}`,
      }),
    );
    expect(html).toMatch(
      /<span style="[^"]*background:#fee2e2;[^"]*color:#991b1b;[^"]*">Do not restart<\/span>/,
    );
    expect(html).toMatch(/<h2 style="[^"]+">Step 1<\/h2>/);
    expect(html).toMatch(/<p style="[^"]+">Click Save<\/p>/);
    expect(html.match(/<p style="[^"]*color:#5f6368;[^"]*">/g)).toHaveLength(1);
  });

  it('links the subject when a click-through URL is set', () => {
    const { html } = buildAlertEmailHtml(input({ clickHref: 'x.test' }));
    expect(html).toMatch(/<a href="https:\/\/x\.test\/"[^>]*>VPN outage<\/a>/);
  });

  it('keeps body links with an inline link style', () => {
    const { html } = buildAlertEmailHtml(
      input({ bodyHtml: '<p><a href="https://x.test/help">help</a></p>' }),
    );
    expect(html).toMatch(
      /<a href="https:\/\/x\.test\/help" style="[^"]*text-decoration:underline;[^"]*">help<\/a>/,
    );
  });
});

describe('guide blocks in the Outlook card', () => {
  const NO_OUTLOOK_HAZARDS = /class=|<svg|rgba\(/i;

  it('renders a step as a numbered two-cell table', () => {
    const { html } = buildAlertEmailHtml(
      input({ bodyHtml: stepBlockHtml('Open the portal', '<p>Sign in first.</p>') }),
    );
    expect(html).toMatch(/<td[^>]*bgcolor="#d32f2f"[^>]*>1<\/td>/);
    expect(html).toContain('Open the portal');
    expect(html).toContain('Sign in first.');
    expect(html).not.toMatch(NO_OUTLOOK_HAZARDS);
  });

  it('numbers steps in document order after a move', () => {
    const bodyHtml = stepBlockHtml('B') + '<h2>Between</h2>' + stepBlockHtml('A');
    const { html } = buildAlertEmailHtml(input({ bodyHtml }));
    expect(html).toMatch(/>1<\/td>[\s\S]*>B<[\s\S]*>2<\/td>[\s\S]*>A</);

    const text = buildAlertEmailText(input({ bodyHtml }));
    expect(text.indexOf('1. B')).toBeGreaterThan(-1);
    expect(text.indexOf('2. A')).toBeGreaterThan(text.indexOf('1. B'));
  });

  it('renders callouts with tone colors and attaches only used tone icons', () => {
    const { html, inlineImages } = buildAlertEmailHtml(
      input({
        bodyHtml: calloutBlockHtml('warning', '<p>Save your work.</p>'),
        assets: {
          iconStripDataUrl: PNG_1X1,
          toneIcons: { note: PNG_1X1, warning: PNG_2X3, success: PNG_1X1 },
        },
      }),
    );
    expect(html).toContain('#FFF4E5');
    expect(html).toContain('border-left:4px solid #B45309');
    expect(html).toContain('src="cid:relay-alert-tone-warning"');
    expect(html).not.toMatch(NO_OUTLOOK_HAZARDS);
    const cids = inlineImages.map((image) => image.cid);
    expect(cids).toContain('relay-alert-tone-warning');
    expect(cids).not.toContain('relay-alert-tone-note');
    expect(cids).not.toContain('relay-alert-tone-success');
  });

  it('attaches each tone icon once however many callouts use it', () => {
    const { inlineImages } = buildAlertEmailHtml(
      input({
        bodyHtml: calloutBlockHtml('note', '<p>A</p>') + calloutBlockHtml('note', '<p>B</p>'),
        assets: { iconStripDataUrl: PNG_1X1, toneIcons: { note: PNG_1X1 } },
      }),
    );
    expect(inlineImages.filter((image) => image.cid === 'relay-alert-tone-note')).toHaveLength(1);
  });

  it('omits the tone icon when its asset is missing', () => {
    const { html, inlineImages } = buildAlertEmailHtml(
      input({ bodyHtml: calloutBlockHtml('note', '<p>Heads up.</p>') }),
    );
    expect(html).toContain('Heads up.');
    expect(html).toContain('#F1F3F5');
    expect(html).not.toContain('relay-alert-tone');
    expect(inlineImages.map((image) => image.cid)).toEqual(['relay-alert-icon']);
  });

  it('renders divider and button', () => {
    const { html } = buildAlertEmailHtml(
      input({ bodyHtml: dividerBlockHtml() + buttonBlockHtml('https://x.test/a', 'Open portal') }),
    );
    expect(html).toMatch(/<td[^>]*height="1"[^>]*style="[^"]*height:1px;/);
    expect(html).toMatch(
      /<td[^>]*bgcolor="#d32f2f"[^>]*><a href="https:\/\/x\.test\/a" style="[^"]*color:#ffffff;[^"]*">Open portal<\/a><\/td>/,
    );
    expect(html).not.toContain('<hr');
    expect(html).not.toMatch(NO_OUTLOOK_HAZARDS);
  });

  it('numbers images inside steps with the body CIDs', () => {
    const { html, inlineImages } = buildAlertEmailHtml(
      input({ bodyHtml: stepBlockHtml('Sign in', figure(PNG_2X3, 'The sign-in page')) }),
    );
    expect(html).toContain('src="cid:relay-alert-body-0" width="2" height="3"');
    expect(html).toContain('The sign-in page');
    expect(inlineImages.map((image) => image.cid)).toEqual([
      'relay-alert-icon',
      'relay-alert-body-0',
    ]);
  });

  it('leaves out the empty typing line the editor keeps after each image', () => {
    const { html } = buildAlertEmailHtml(
      input({
        bodyHtml:
          stepBlockHtml('Sign in', `<p>Open it.</p>${figure(PNG_1X1)}<p><br></p>`) +
          `${figure(PNG_1X1)}<p><br></p><p>After</p>`,
      }),
    );
    expect(html).not.toMatch(/<p[^>]*><br><\/p>/);
    expect(html).toContain('Open it.');
    expect(html).toContain('After');
  });

  it('keeps a blank line the writer added between paragraphs', () => {
    const { html } = buildAlertEmailHtml(input({ bodyHtml: '<p>One</p><p><br></p><p>Two</p>' }));
    expect(html).toMatch(/<p[^>]*><br><\/p>/);
  });
});

describe('alertCalloutTonesIn', () => {
  it('lists each callout tone the body uses once, in order', () => {
    const bodyHtml =
      calloutBlockHtml('success') + calloutBlockHtml('note') + calloutBlockHtml('success');
    expect(alertCalloutTonesIn(bodyHtml)).toEqual(['success', 'note']);
    expect(alertCalloutTonesIn('<p>Plain</p>')).toEqual([]);
  });
});

describe('buildAlertEmailText', () => {
  it('writes blocks as numbered steps, labeled callouts, a rule and a link line', () => {
    const text = buildAlertEmailText({
      severity: 'INFO',
      subject: 'VPN setup',
      sender: 'IT',
      recipient: 'All Employees',
      bodyHtml:
        stepBlockHtml('Open the client', '<p>Find it in the Start menu.</p><p>Click it.</p>') +
        calloutBlockHtml('note', '<p>Use your work account.</p>') +
        calloutBlockHtml('warning', '<p>Do not share codes.</p>') +
        calloutBlockHtml('success', '<p>You see Connected.</p>') +
        dividerBlockHtml() +
        buttonBlockHtml('https://x.test/a', 'Open portal'),
    });
    expect(text).toContain(
      '1. Open the client\n   Find it in the Start menu.\n\n   Click it.\n\nNote: Use your work account.\n\nWarning: Do not share codes.\n\nExpected result: You see Connected.\n\n----------\n\nOpen portal: https://x.test/a',
    );
  });

  it('builds plain text with headings, image captions and links', () => {
    const text = buildAlertEmailText({
      severity: 'ISSUE',
      subject: 'VPN outage',
      sender: 'IT',
      recipient: 'All Employees',
      bodyHtml: `<h2>Step 1</h2>${figure(PNG_1X1, 'Click Save')}<p><a href="https://x.test/">docs</a></p>`,
    });
    expect(text).toContain('Step 1\n\n[Image: Click Save]\n\ndocs (https://x.test/)');
    expect(text).toContain('ALERT ISSUE');
  });
});

describe('readImageSize', () => {
  it('reads PNG dimensions from the header', () => {
    expect(readImageSize(PNG_2X3)).toEqual({ width: 2, height: 3 });
  });

  it('returns null for data it cannot read', () => {
    expect(readImageSize('data:image/webp;base64,AAAA')).toBeNull();
  });
});
