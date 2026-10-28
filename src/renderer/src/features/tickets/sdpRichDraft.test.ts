import { describe, expect, it } from 'vitest';
import { sdpRichEditorHtml, sdpRichHtml } from '@shared/sdpRichText';
import { replyQuoteMarkup, richMarkupFromHtml, richMarkupFromNode } from './sdpRichDraft';

const editor = (html: string) => {
  const node = document.createElement('div');
  node.innerHTML = html;
  return node;
};

describe('richMarkupFromNode', () => {
  it('reads an edited reply line for line, with its formatting and escaped text', () => {
    const node = editor(
      'Hi <b>team</b>,<div><br></div><div><i>Note</i> 2*3 [x] a_b</div>' +
        '<ul><li>One</li><li><u>Two</u></li></ul><ol><li>First</li></ol>' +
        '<div>- not a list</div><div><a href="https://example.test/kb">KB</a> ' +
        '<a href="javascript:alert(1)">bad</a></div>',
    );
    expect(richMarkupFromNode(node)).toBe(
      [
        'Hi **team**,',
        '',
        String.raw`*Note* 2\*3 \[x\] a\_b`,
        '- One',
        '- __Two__',
        '1. First',
        String.raw`\- not a list`,
        '[KB](https://example.test/kb) bad',
      ].join('\n'),
    );
  });

  it('round-trips through the editor rendering, including quotes and blank lines', () => {
    const markup = 'Thanks,\n\nPat\n> -----Original Message-----\n> From: Sam\n>\n> **Bold** line';
    expect(richMarkupFromNode(editor(sdpRichEditorHtml(markup)))).toBe(markup);
  });

  it('keeps bold across a line break as two bold lines', () => {
    expect(richMarkupFromNode(editor('<b>one<br>two</b>'))).toBe('**one**\n**two**');
    expect(sdpRichHtml('**one**\n**two**')).toBe('<strong>one</strong><br><strong>two</strong>');
  });
});

describe('richMarkupFromHtml', () => {
  it('folds email layout into paragraphs, lists, links and emphasis', () => {
    const html = `<html><head><style>p{}</style></head><body>
      <p>Hello,</p>
      <p><span style="font-weight:bold">Outage</span> on <strong>VPN</strong><br></p>


      <table><tr><td>Site</td><td>Denver</td></tr></table>
      <h2>Next steps</h2>
      <img src="cid:x" alt="logo">
      <ul><li>Restart</li></ul>
    </body></html>`;
    expect(richMarkupFromHtml(html)).toBe(
      'Hello,\n**Outage** on **VPN**\nSite Denver\n**Next steps**\n- Restart',
    );
  });
});

describe('replyQuoteMarkup', () => {
  it('quotes the message header and its own text, without the earlier mail it quotes', () => {
    const markup = replyQuoteMarkup({
      author: 'Pat [Ops]',
      createdAt: null,
      subject: 'VPN *down*',
      body: '<p>Still <b>failing</b>.</p><div class="gmail_quote">Old thread</div>',
    });
    expect(markup.startsWith('\n\n> -----Original Message-----\n')).toBe(true);
    expect(markup).toContain(String.raw`> From: Pat \[Ops\]`);
    expect(markup).toContain(String.raw`> Subject: VPN \*down\*`);
    expect(markup).toContain('> Still **failing**.');
    expect(markup).not.toContain('Old thread');
  });

  it('cuts a long message at a line so the reply still fits', () => {
    const body = Array.from({ length: 2000 }, (_, i) => `<div>Line ${i} of the message</div>`);
    const markup = replyQuoteMarkup({ author: 'Pat', createdAt: null, body: body.join('') });
    expect(markup.length).toBeLessThan(9100);
    expect(markup.endsWith('\n> …')).toBe(true);
  });
});
