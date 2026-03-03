import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeHtml, hasVisibleText } from '../alertUtils';

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

  describe('disallowed tags stripped', () => {
    it('strips <script> tags and their content', () => {
      // DOMParser does not expose script content as text nodes when parsing text/html,
      // so the script body is entirely removed -- which is the desired secure behavior.
      expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('');
    });

    it('strips <img> tags', () => {
      expect(sanitizeHtml('<img src="x.png">')).toBe('');
    });

    it('strips <div> tags but keeps text content', () => {
      expect(sanitizeHtml('<div>content</div>')).toBe('content');
    });

    it('strips <span> tags but keeps text content', () => {
      expect(sanitizeHtml('<span>content</span>')).toBe('content');
    });

    it('strips <a> tags but keeps text content', () => {
      expect(sanitizeHtml('<a href="http://evil.com">click</a>')).toBe('click');
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
      expect(sanitizeHtml('<div><b>bold</b></div>')).toBe('<b>bold</b>');
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
        '<b>bold</b>x<i>italic</i>',
      );
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
