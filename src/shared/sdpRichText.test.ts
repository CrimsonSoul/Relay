import { describe, expect, it } from 'vitest';
import { sdpRichEscape, sdpRichHtml, sdpRichPlain } from './sdpRichText';

describe('sdpRichHtml', () => {
  it('renders plain lines as escaped text with line breaks, like plain replies', () => {
    expect(sdpRichHtml('Hi <team> & "all"\n\nThanks')).toBe(
      'Hi &lt;team&gt; &amp; &quot;all&quot;<br><br>Thanks',
    );
  });

  it('renders bold, italic, underline and links, closing marks left open', () => {
    expect(sdpRichHtml('**Bold** *it* __under__ [Portal](https://example.test/a?b=1&c=2)')).toBe(
      '<strong>Bold</strong> <em>it</em> <u>under</u> <a href="https://example.test/a?b=1&amp;c=2">Portal</a>',
    );
    expect(sdpRichHtml('**open *both')).toBe('<strong>open <em>both</em></strong>');
    expect(sdpRichHtml('**a *b** c*')).toBe('<strong>a <em>b</em></strong><em> c</em>');
  });

  it('never turns other link schemes or raw HTML into markup', () => {
    expect(sdpRichHtml('[x](javascript:alert(1)) <img src=x onerror=alert(1)>')).toBe(
      '[x](javascript:alert(1)) &lt;img src=x onerror=alert(1)&gt;',
    );
    expect(sdpRichHtml('[x](https://a.test/"onmouseover=1)')).toBe(
      '[x](https://a.test/&quot;onmouseover=1)',
    );
  });

  it('renders bullets, numbered items and nested quotes as blocks', () => {
    expect(sdpRichHtml('Steps:\n- one\n- **two**\n3. three\n4. four\nDone')).toBe(
      'Steps:<ul><li>one</li><li><strong>two</strong></li></ul><ol start="3"><li>three</li><li>four</li></ol>Done',
    );
    expect(sdpRichHtml('Reply\n> From: A\n>\n> > older\n> - item')).toContain(
      'Reply<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex">From: A<br><blockquote',
    );
    expect(sdpRichHtml('> - item')).toContain('<ul><li>item</li></ul></blockquote>');
  });

  it('reads escaped characters literally', () => {
    expect(sdpRichHtml(String.raw`\*not italic\* \- \[x\](https://a.test) a\\b`)).toBe(
      String.raw`*not italic* - [x](https://a.test) a\b`,
    );
  });
});

describe('sdpRichEscape', () => {
  it('round-trips any text, including line markers and markup characters', () => {
    const text =
      '- not a bullet\n> not a quote\n12. not numbered\n**a** __b__ [c](https://d.test) \\';
    expect(sdpRichHtml(sdpRichEscape(text))).toBe(
      '- not a bullet<br>&gt; not a quote<br>12. not numbered<br>**a** __b__ [c](https://d.test) \\',
    );
    expect(sdpRichPlain(sdpRichEscape(text))).toBe(text);
  });
});

describe('sdpRichPlain', () => {
  it('drops formatting marks and spells out links, keeping line markers', () => {
    expect(sdpRichPlain('**Hi** *there*\n- [Portal](https://p.test)\n> __quoted__\n2. two')).toBe(
      'Hi there\n- Portal (https://p.test)\n> quoted\n2. two',
    );
  });
});
