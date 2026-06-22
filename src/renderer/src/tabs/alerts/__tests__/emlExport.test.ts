import { describe, expect, it } from 'vitest';
import { buildAlertEml } from '../emlExport';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function decodeHtmlPart(eml: string): string {
  const htmlPart =
    /Content-Type: text\/html; charset="UTF-8"\r?\nContent-Transfer-Encoding: base64\r?\n\r?\n([\s\S]*?)\r?\n------=/.exec(
      eml,
    );
  if (!htmlPart) throw new Error('HTML part not found');
  return Buffer.from(htmlPart[1].replaceAll(/\s/g, ''), 'base64').toString('utf8');
}

describe('buildAlertEml', () => {
  it('creates one Outlook-safe alert card with clickable links and inline CID images', () => {
    const eml = buildAlertEml({
      severity: 'ISSUE',
      displaySubject: 'Database latency',
      displaySender: 'IT Operations',
      displayRecipient: 'All Employees',
      bodyHtml: `<p>Open <a href="https://example.com/dashboard">dashboard</a>.</p><p><a href="https://example.com/chart"><img src="${tinyPng}" alt="Latency chart"></a></p><p><a href="javascript:alert(1)">unsafe</a></p>`,
      logoDataUrl: tinyPng,
      footerLogoDataUrl: tinyPng,
      eventTimeStartIso: '2026-06-17T18:00:00.000Z',
      eventTimeEndIso: '2026-06-17T19:00:00.000Z',
      alertBodyFontSize: 'large',
      generatedAt: new Date('2026-06-17T18:15:00.000Z'),
    });

    expect(eml).toContain('Content-Type: multipart/related;');
    expect(eml).toContain('Subject: ISSUE - Database latency');
    expect(eml).not.toContain('Content-ID: <relay-alert-card-1>');
    expect(eml).toContain('Content-ID: <relay-logo-1>');
    expect(eml).toContain('Content-ID: <relay-footer-logo-1>');
    expect(eml).toContain('Content-ID: <relay-body-image-1>');
    expect(eml).not.toContain('Content-ID: <relay-severity-badge-1>');

    const html = decodeHtmlPart(eml);
    expect(html).toContain('<table class="relay-email-card"');
    expect(html).toContain('src="cid:relay-logo-1"');
    expect(html).toContain('src="cid:relay-footer-logo-1"');
    expect(html).not.toContain('src="cid:relay-alert-card-1"');
    expect(html).not.toContain('Relay alert visual');
    expect(html).not.toContain('Links and embedded content');
    expect(html).not.toContain('Clickable links and inline images are included below.');
    expect(html).not.toContain('relay-email-visual-shell');
    expect(html).not.toContain('relay-email-utility');
    expect(html).not.toContain('Live links and details');
    expect(html).toContain('<a href="https://example.com/dashboard"');
    expect(html).toContain('<a href="https://example.com/chart"');
    expect(html).toContain('src="cid:relay-body-image-1"');
    expect(html).toContain('font-size:19px;');
    expect(html.indexOf('<a href="https://example.com/chart"')).toBeLessThan(
      html.indexOf('src="cid:relay-body-image-1"'),
    );
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('var(--');
  });

  it('mirrors the PNG alert card visual rhythm in email-safe markup', () => {
    const eml = buildAlertEml({
      severity: 'ISSUE',
      displaySubject: 'Database latency',
      displaySender: 'IT Operations',
      displayRecipient: 'All Employees',
      bodyHtml: '<p>Latency remains elevated.</p>',
      logoDataUrl: null,
      footerLogoDataUrl: null,
      eventTimeStartIso: '2026-06-17T18:00:00.000Z',
      eventTimeEndIso: '2026-06-17T19:00:00.000Z',
      generatedAt: new Date('2026-06-17T18:15:00.000Z'),
    });

    const html = decodeHtmlPart(eml);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('.relay-email-page');
    expect(html).toContain('.relay-email-card');
    expect(html).toContain('.relay-email-title');
    expect(html).toContain('.relay-email-meta');
    expect(html).toContain('.relay-email-content');
    expect(html).toContain('[data-ogsc] .relay-email-content');
    expect(html).toContain('[data-ogsb] .relay-email-content');
    expect(html).toContain('.relay-email-content-lock');
    expect(html).toContain('[data-ogsb] .relay-email-content-lock');
    expect(html).toContain('.relay-email-content-lock[data-ogsb]');
    expect(html).toContain('background-image:linear-gradient(#202124,#202124) !important;');
    expect(html).toContain('background-image:linear-gradient(#f7f7f8,#f7f7f8);');
    expect(html).toContain('background-color:#191a1d !important;');
    expect(html).toContain('color:#f3f4f6 !important;');
    expect(html).toContain('border-color:#3a3d42 !important;');
    expect(html).toContain('box-shadow:0 2px 20px rgba(0,0,0,0.1);');
    expect(html).toContain('padding:16px 36px 18px;');
    expect(html).not.toContain('margin-top:-26px; margin-bottom:-4px;');
    expect(html).not.toContain('0 2px 4px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.1)');
    expect(html).not.toContain('font-size:30px; font-weight:800; line-height:54px;');
    expect(html).toContain('bgcolor="#d32f2f"');
    expect(html).toContain('background-color:#d32f2f;');
    expect(html).toContain('color:#ffffff;');
    expect(html).not.toContain('relay-severity-badge-1');
    expect(html).toContain('padding:24px 36px 26px;');
    expect(html).toContain('padding:28px 36px 36px;');
    expect(html).toContain('font-size:14.5px;');
    expect(html).toContain('min-height:350px;');
    expect(html).toContain('Started');
    expect(html).not.toContain('Event window');
    expect(html).not.toContain('Generated by Relay');
    expect(html).toContain('RELAY</span>');
  });
});
