import { describe, it, expect } from 'vitest';
import {
  ALERT_BUTTON_LABEL_MAX_LENGTH,
  ALERT_CALLOUT_TONES,
  alertBlockKind,
  buttonBlockHtml,
  calloutBlockHtml,
  dividerBlockHtml,
  stepBlockHtml,
} from '../alertBlocks';

function firstElement(html: string): Element {
  return new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
}

describe('alert block builders', () => {
  it('builds an empty step with a title and an empty paragraph', () => {
    expect(stepBlockHtml()).toBe('<div data-relay-block="step"><h3></h3><p><br></p></div>');
  });

  it('builds a step with title text and body markup', () => {
    expect(stepBlockHtml('Open', '<p>Go</p>')).toBe(
      '<div data-relay-block="step"><h3>Open</h3><p>Go</p></div>',
    );
  });

  it('escapes titles and button labels', () => {
    expect(stepBlockHtml('<script>x</script>')).toContain(
      '<h3>&lt;script&gt;x&lt;/script&gt;</h3>',
    );
    expect(buttonBlockHtml('https://x.test/a', '<b>Go</b>')).toBe(
      '<p data-relay-block="button"><a href="https://x.test/a">&lt;b&gt;Go&lt;/b&gt;</a></p>',
    );
  });

  it('builds callouts for each tone', () => {
    expect(ALERT_CALLOUT_TONES).toEqual(['note', 'warning', 'success']);
    expect(calloutBlockHtml('warning', '<p>Careful</p>')).toBe(
      '<div data-relay-block="callout" data-tone="warning"><p>Careful</p></div>',
    );
    expect(calloutBlockHtml('note')).toBe(
      '<div data-relay-block="callout" data-tone="note"><p><br></p></div>',
    );
  });

  it('builds a divider', () => {
    expect(dividerBlockHtml()).toBe('<hr data-relay-block="divider">');
  });

  it('refuses a button link that is not http or https', () => {
    expect(() => buttonBlockHtml('javascript:x', 'a')).toThrow(
      'Button links must be http or https.',
    );
  });

  it('refuses an empty or over-long button label', () => {
    expect(() => buttonBlockHtml('https://x.test', '  ')).toThrow('Enter a button label.');
    expect(() =>
      buttonBlockHtml('https://x.test', 'x'.repeat(ALERT_BUTTON_LABEL_MAX_LENGTH + 1)),
    ).toThrow('Use 60 characters or fewer.');
  });

  it('identifies block elements by kind', () => {
    expect(alertBlockKind(firstElement(stepBlockHtml()))).toBe('step');
    expect(alertBlockKind(firstElement(calloutBlockHtml('success')))).toBe('callout');
    expect(alertBlockKind(firstElement(dividerBlockHtml()))).toBe('divider');
    expect(alertBlockKind(firstElement(buttonBlockHtml('https://x.test', 'Go')))).toBe('button');
    expect(alertBlockKind(firstElement('<div data-relay-block="other"></div>'))).toBeNull();
    expect(alertBlockKind(firstElement('<span data-relay-block="step"></span>'))).toBeNull();
    expect(alertBlockKind(firstElement('<p>x</p>'))).toBeNull();
  });
});
