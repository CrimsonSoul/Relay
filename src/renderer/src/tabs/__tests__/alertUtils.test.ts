import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeHtml, hasVisibleText, isAlertMessageComplete } from '../alertUtils';
import {
  buttonBlockHtml,
  calloutBlockHtml,
  dividerBlockHtml,
  stepBlockHtml,
} from '../alerts/alertBlocks';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  it('passes through safe text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('escapes all special characters in a combined string', () => {
    expect(escapeHtml('<div class="x">&</div>')).toBe(
      '&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;',
    );
  });

  it('escapes multiple occurrences of the same character', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });
});

describe('sanitizeHtml', () => {
  describe('allowed tags', () => {
    it('preserves <b> tags', () => {
      expect(sanitizeHtml('<b>bold</b>')).toBe('<b>bold</b>');
    });

    it('preserves <i> tags', () => {
      expect(sanitizeHtml('<i>italic</i>')).toBe('<i>italic</i>');
    });

    it('preserves <u> tags', () => {
      expect(sanitizeHtml('<u>underline</u>')).toBe('<u>underline</u>');
    });

    it('preserves <em> tags', () => {
      expect(sanitizeHtml('<em>emphasis</em>')).toBe('<em>emphasis</em>');
    });

    it('preserves <strong> tags', () => {
      expect(sanitizeHtml('<strong>strong</strong>')).toBe('<strong>strong</strong>');
    });

    it('preserves <br> tags as self-closing', () => {
      expect(sanitizeHtml('line1<br>line2')).toBe('line1<br>line2');
    });

    it('preserves <p> tags', () => {
      expect(sanitizeHtml('<p>paragraph</p>')).toBe('<p>paragraph</p>');
    });

    it('preserves <ul> and <li> tags', () => {
      expect(sanitizeHtml('<ul><li>item</li></ul>')).toBe('<ul><li>item</li></ul>');
    });

    it('preserves <ol> and <li> tags', () => {
      expect(sanitizeHtml('<ol><li>first</li><li>second</li></ol>')).toBe(
        '<ol><li>first</li><li>second</li></ol>',
      );
    });
  });

  describe('guide markup', () => {
    it('keeps guide headings, figures and captions', () => {
      expect(sanitizeHtml('<h2 style="x">Step 1</h2>')).toBe('<h2>Step 1</h2>');
      expect(
        sanitizeHtml(
          '<figure class="alert-body-figure" onclick="x"><img src="data:image/png;base64,AAAA" alt="a" class="alert-body-image"><figcaption>Cap</figcaption></figure>',
        ),
      ).toBe(
        '<figure class="alert-body-figure"><img src="data:image/png;base64,AAAA" alt="a" class="alert-body-image"><figcaption>Cap</figcaption></figure>',
      );
    });

    it('keeps stored image references without src', () => {
      expect(sanitizeHtml('<img data-relay-image="3" alt="Login">')).toBe(
        '<img data-relay-image="3" alt="Login">',
      );
      expect(sanitizeHtml('<img data-relay-image="x" alt="a">')).toBe('');
      expect(sanitizeHtml('<img data-relay-image="1" src="https://evil.test/a.png">')).toBe(
        '<img data-relay-image="1" alt="">',
      );
    });
  });

  describe('disallowed tags stripped', () => {
    it('strips <script> tags and their content', () => {
      // DOMParser does not expose script content as text nodes when parsing text/html,
      // so the script body is entirely removed -- which is the desired secure behavior.
      expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('');
    });

    it('strips <img> tags', () => {
      expect(sanitizeHtml('<img src="x.png">')).toBe('');
    });

    it('preserves div block boundaries without retaining unsafe attributes', () => {
      expect(sanitizeHtml('<div onclick="bad()">First</div><div>Second</div>')).toBe(
        '<div>First</div><div>Second</div>',
      );
    });

    it('strips <span> tags but keeps text content', () => {
      expect(sanitizeHtml('<span>content</span>')).toBe('content');
    });

    it('keeps http links and drops unsafe ones', () => {
      expect(sanitizeHtml('<a href="https://x.test/a" target="_blank">go</a>')).toBe(
        '<a href="https://x.test/a">go</a>',
      );
      expect(sanitizeHtml('<a href="javascript:alert(1)">go</a>')).toBe('go');
      expect(sanitizeHtml('<a href="https://u:p@x.test">go</a>')).toBe('go');
    });

    it('drops h1 and other heading levels to their text, and h3 outside a step to bold', () => {
      expect(sanitizeHtml('<h1>A</h1><h4>C</h4><h3>B</h3>')).toBe('AC<p><strong>B</strong></p>');
    });

    it('preserves the alert body image marker but strips arbitrary image classes', () => {
      const image = 'data:image/jpeg;base64,abcd';
      expect(
        sanitizeHtml(`<img src="${image}" alt="Dashboard" class="alert-body-image evil">`),
      ).toBe(`<img src="${image}" alt="Dashboard" class="alert-body-image">`);
    });
  });

  describe('attributes stripped from allowed tags', () => {
    it('strips class attribute from <b>', () => {
      expect(sanitizeHtml('<b class="red">text</b>')).toBe('<b>text</b>');
    });

    it('strips style attribute from <i>', () => {
      expect(sanitizeHtml('<i style="color:red">text</i>')).toBe('<i>text</i>');
    });

    it('strips onclick attribute from <p>', () => {
      expect(sanitizeHtml('<p onclick="alert(1)">text</p>')).toBe('<p>text</p>');
    });

    it('strips id attribute from <strong>', () => {
      expect(sanitizeHtml('<strong id="x">text</strong>')).toBe('<strong>text</strong>');
    });
  });

  describe('nested structures', () => {
    it('handles nested allowed tags', () => {
      expect(sanitizeHtml('<p><b>bold</b> and <i>italic</i></p>')).toBe(
        '<p><b>bold</b> and <i>italic</i></p>',
      );
    });

    it('strips disallowed parent but keeps allowed children', () => {
      expect(sanitizeHtml('<article><b>bold</b></article>')).toBe('<b>bold</b>');
    });

    it('strips disallowed child inside allowed parent', () => {
      expect(sanitizeHtml('<p><span>text</span></p>')).toBe('<p>text</p>');
    });
  });

  describe('XSS vectors', () => {
    it('strips script tags completely', () => {
      const result = sanitizeHtml('<script>document.cookie</script>');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('</script');
    });

    it('strips onerror handlers on img tags', () => {
      const result = sanitizeHtml('<img src=x onerror="alert(1)">');
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('<img');
    });

    it('strips javascript: URLs in anchor tags', () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<a');
      expect(result).toBe('click');
    });

    it('strips event handlers on allowed tags', () => {
      const result = sanitizeHtml('<b onmouseover="alert(1)">text</b>');
      expect(result).toBe('<b>text</b>');
      expect(result).not.toContain('onmouseover');
    });

    it('strips nested script inside allowed tags', () => {
      const result = sanitizeHtml('<p><script>alert(1)</script>safe</p>');
      expect(result).not.toContain('<script');
      expect(result).toContain('safe');
    });

    it('strips iframe tags', () => {
      const result = sanitizeHtml('<iframe src="http://evil.com"></iframe>');
      expect(result).not.toContain('<iframe');
    });
  });

  describe('non-element, non-text nodes', () => {
    it('strips HTML comment nodes', () => {
      expect(sanitizeHtml('before<!-- comment -->after')).toBe('beforeafter');
    });

    it('strips processing instruction style comments', () => {
      expect(sanitizeHtml('a<!-- x -->b<!-- y -->c')).toBe('abc');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('passes through plain text unchanged', () => {
      expect(sanitizeHtml('just plain text')).toBe('just plain text');
    });

    it('escapes special characters in text nodes', () => {
      expect(sanitizeHtml('1 < 2 & 3 > 0')).toBe('1 &lt; 2 &amp; 3 &gt; 0');
    });

    it('handles mixed allowed and disallowed tags', () => {
      expect(sanitizeHtml('<div><b>bold</b><script>x</script><i>italic</i></div>')).toBe(
        '<div><b>bold</b>x<i>italic</i></div>',
      );
    });
  });

  describe('highlight spans', () => {
    it('preserves span with known data-hl value', () => {
      const input = '<span data-hl="deadline">60 days</span>';
      expect(sanitizeHtml(input)).toBe('<span data-hl="deadline">60 days</span>');
    });

    it('strips span with unknown data-hl value', () => {
      const input = '<span data-hl="evil">text</span>';
      expect(sanitizeHtml(input)).toBe('text');
    });

    it('strips span with no data-hl attribute', () => {
      const input = '<span class="foo">text</span>';
      expect(sanitizeHtml(input)).toBe('text');
    });

    it('preserves nested content inside highlight span', () => {
      const input = '<span data-hl="warning"><b>critical</b> issue</span>';
      expect(sanitizeHtml(input)).toBe('<span data-hl="warning"><b>critical</b> issue</span>');
    });

    it('strips data-hl span that also has other attributes', () => {
      const input = '<span data-hl="deadline" onclick="alert(1)">text</span>';
      // Should keep data-hl but strip onclick
      expect(sanitizeHtml(input)).toBe('<span data-hl="deadline">text</span>');
    });
  });

  describe('guide blocks', () => {
    it('keeps each block shape', () => {
      const html =
        stepBlockHtml('Open', '<p>Go</p>') +
        calloutBlockHtml('warning', '<p>Careful</p>') +
        dividerBlockHtml() +
        buttonBlockHtml('https://x.test/a', 'Open portal');
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('keeps an empty step title and a captioned image inside a step', () => {
      const html =
        '<div data-relay-block="step"><h3></h3><p>Body</p><figure class="alert-body-figure"><img data-relay-image="0" alt="x"><figcaption>c</figcaption></figure></div>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('drops extra attributes on blocks', () => {
      expect(
        sanitizeHtml(
          '<div data-relay-block="step" style="x" onclick="y" class="z" data-tone="note"><h3 class="t">T</h3></div>',
        ),
      ).toBe('<div data-relay-block="step"><h3>T</h3></div>');
      expect(
        sanitizeHtml(
          '<p data-relay-block="button" style="x"><a href="https://x.test/" target="_blank" onclick="y">Go</a></p>',
        ),
      ).toBe('<p data-relay-block="button"><a href="https://x.test/">Go</a></p>');
    });

    it('unwraps a block nested in a block, list or figure', () => {
      expect(
        sanitizeHtml(
          '<div data-relay-block="step"><h3>A</h3><div data-relay-block="step"><h3>B</h3><p>inner</p></div></div>',
        ),
      ).toBe('<div data-relay-block="step"><h3>A</h3><p><strong>B</strong></p><p>inner</p></div>');
      expect(
        sanitizeHtml(
          '<ul><li><div data-relay-block="callout" data-tone="note"><p>n</p></div></li></ul>',
        ),
      ).toBe('<ul><li><p>n</p></li></ul>');
    });

    it('turns an unknown tone into note', () => {
      expect(
        sanitizeHtml('<div data-relay-block="callout" data-tone="danger"><p>x</p></div>'),
      ).toBe('<div data-relay-block="callout" data-tone="note"><p>x</p></div>');
      expect(sanitizeHtml('<div data-relay-block="callout"><p>x</p></div>')).toBe(
        '<div data-relay-block="callout" data-tone="note"><p>x</p></div>',
      );
    });

    it('keeps callouts to text', () => {
      expect(
        sanitizeHtml(
          '<div data-relay-block="callout" data-tone="success"><h2>Done</h2><figure class="alert-body-figure"><img src="data:image/png;base64,iVBORw0KGgo=" alt="x"><figcaption>c</figcaption></figure><p>ok</p></div>',
        ),
      ).toBe(
        '<div data-relay-block="callout" data-tone="success"><p><strong>Done</strong></p><p>ok</p></div>',
      );
    });

    it('keeps callouts to text at every depth', () => {
      expect(
        sanitizeHtml(
          '<div data-relay-block="callout" data-tone="note"><p>See <img src="data:image/png;base64,iVBORw0KGgo=" alt="x"></p><div><h2>Deep</h2></div></div>',
        ),
      ).toBe(
        '<div data-relay-block="callout" data-tone="note"><p>See </p><div><p><strong>Deep</strong></p></div></div>',
      );
    });

    it('turns a heading wrapped inside a step into a bold paragraph', () => {
      expect(
        sanitizeHtml('<div data-relay-block="step"><h3>T</h3><div><h2>Deep</h2></div></div>'),
      ).toBe(
        '<div data-relay-block="step"><h3>T</h3><div><p><strong>Deep</strong></p></div></div>',
      );
    });

    it('gives a step without a title an empty one so its first paragraph stays body', () => {
      expect(sanitizeHtml('<div data-relay-block="step"><p>Body</p></div>')).toBe(
        '<div data-relay-block="step"><h3></h3><p>Body</p></div>',
      );
      expect(sanitizeHtml('<div data-relay-block="step">loose text</div>')).toBe(
        '<div data-relay-block="step"><h3></h3>loose text</div>',
      );
    });

    it('turns an unsafe or empty button into a paragraph', () => {
      expect(
        sanitizeHtml(
          '<p data-relay-block="button"><a href="javascript:alert(1)">Open portal</a></p>',
        ),
      ).toBe('<p>Open portal</p>');
      expect(sanitizeHtml('<p data-relay-block="button"><a href="https://x.test/"> </a></p>')).toBe(
        '',
      );
      const long = 'x'.repeat(61);
      expect(
        sanitizeHtml(`<p data-relay-block="button"><a href="https://x.test/">${long}</a></p>`),
      ).toBe(`<p>${long}</p>`);
    });

    it('converts h3 outside a step to a bold paragraph', () => {
      expect(sanitizeHtml('<h3>X</h3>')).toBe('<p><strong>X</strong></p>');
      expect(sanitizeHtml('<div data-relay-block="step"><h3>T</h3><p>a</p><h3>Y</h3></div>')).toBe(
        '<div data-relay-block="step"><h3>T</h3><p>a</p><p><strong>Y</strong></p></div>',
      );
    });

    it('drops a divider marker on anything but hr and a plain hr', () => {
      expect(sanitizeHtml('<hr>')).toBe('');
      expect(sanitizeHtml('<hr data-relay-block="divider" style="x">')).toBe(
        '<hr data-relay-block="divider">',
      );
    });

    it('loads a guide whose block wrappers an older client stripped', () => {
      expect(sanitizeHtml('<h3>T</h3><p>Body</p>')).toBe('<p><strong>T</strong></p><p>Body</p>');
    });
  });
});

describe('hasVisibleText', () => {
  it('returns true for plain text content', () => {
    expect(hasVisibleText('hello')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasVisibleText('')).toBe(false);
  });

  it('returns false for whitespace-only HTML', () => {
    expect(hasVisibleText('   \n\t  ')).toBe(false);
  });

  it('returns false for zero-width-only HTML', () => {
    expect(hasVisibleText('<p>\u200b</p>')).toBe(false);
  });

  it('returns false for tags-only content like <br>', () => {
    expect(hasVisibleText('<br>')).toBe(false);
  });

  it('returns false for tags-only content with multiple br tags', () => {
    expect(hasVisibleText('<br><br><br>')).toBe(false);
  });

  it('returns true for HTML with text inside tags', () => {
    expect(hasVisibleText('<p>hello</p>')).toBe(true);
  });

  it('returns true for text mixed with tags', () => {
    expect(hasVisibleText('<b>bold</b> and <i>italic</i>')).toBe(true);
  });

  it('returns false for empty tags with no text', () => {
    expect(hasVisibleText('<p></p><div></div>')).toBe(false);
  });

  it('returns false for tags with only whitespace', () => {
    expect(hasVisibleText('<p>   </p>')).toBe(false);
  });

  it('returns true when text is deeply nested', () => {
    expect(hasVisibleText('<div><p><span>deep</span></p></div>')).toBe(true);
  });
});

describe('isAlertMessageComplete', () => {
  it('requires both a non-empty subject and visible body text', () => {
    expect(isAlertMessageComplete('', '')).toBe(false);
    expect(isAlertMessageComplete('POS outage', '')).toBe(false);
    expect(isAlertMessageComplete('', '<p>Investigating.</p>')).toBe(false);
    expect(isAlertMessageComplete('POS outage', '<p>Investigating.</p>')).toBe(true);
  });

  it('rejects whitespace and invisible editor markers', () => {
    expect(isAlertMessageComplete('   ', '<p>Investigating.</p>')).toBe(false);
    expect(isAlertMessageComplete('POS outage', '<p>\u200b</p>')).toBe(false);
  });
});
