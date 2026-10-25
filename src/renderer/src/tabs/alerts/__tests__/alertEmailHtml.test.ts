import { describe, expect, it } from 'vitest';
import {
  buildAlertEmailHtml,
  buildAlertEmailText,
  readImageSize,
  type AlertEmailHtmlInput,
} from '../alertEmailHtml';

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

describe('buildAlertEmailText', () => {
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
