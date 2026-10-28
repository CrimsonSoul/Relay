import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdpRichReplyEditor, replyLinkHref } from './SdpRichReplyEditor';

// jsdom does not implement contentEditable commands; the calls are what is checked.
const exec = vi.fn().mockReturnValue(true);
beforeEach(() => {
  exec.mockClear();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'execCommand');
});

function paste(target: HTMLElement, data: Record<string, string>) {
  fireEvent.paste(target, { clipboardData: { getData: (type: string) => data[type] ?? '' } });
}

it('opens with an empty line above the quoted message and reports edits as markup', () => {
  const change = vi.fn();
  render(
    <SdpRichReplyEditor
      initial={'\n\n> From: Pat\n> **Down**'}
      disabled={false}
      onChange={change}
    />,
  );
  const body = screen.getByRole('textbox', { name: 'Message' });
  expect(body.innerHTML).toBe(
    '<div><br></div><div><br></div><blockquote><div>From: Pat</div><div><strong>Down</strong></div></blockquote>',
  );
  body.firstElementChild!.textContent = 'On it.';
  fireEvent.input(body);
  expect(change).toHaveBeenLastCalledWith('On it.\n\n> From: Pat\n> **Down**');
});

it('pastes only reply formatting, never the pasted markup itself', () => {
  render(<SdpRichReplyEditor initial="" disabled={false} onChange={vi.fn()} />);
  const body = screen.getByRole('textbox', { name: 'Message' });
  paste(body, {
    'text/html':
      '<b>Bold</b> <img src=x onerror="alert(1)"><script>bad()</script><a href="javascript:x">l</a>',
  });
  expect(exec).toHaveBeenLastCalledWith('insertHTML', false, '<strong>Bold</strong> l');
  paste(body, { 'text/plain': '- <i>literal</i>\r\nnext' });
  expect(exec).toHaveBeenLastCalledWith(
    'insertHTML',
    false,
    '- &lt;i&gt;literal&lt;/i&gt;<br>next',
  );
});

it('applies toolbar formatting and refuses a link that is not a web or mail address', () => {
  render(<SdpRichReplyEditor initial="" disabled={false} onChange={vi.fn()} />);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Bold' }));
  expect(exec).toHaveBeenCalledWith('bold');
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Numbered List' }));
  expect(exec).toHaveBeenCalledWith('insertOrderedList');
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert Link' }));
  const address = screen.getByLabelText('Link address');
  fireEvent.change(address, { target: { value: 'javascript:alert(1)' } });
  fireEvent.keyDown(address, { key: 'Enter' });
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a web address');
  fireEvent.change(address, { target: { value: 'example.test/kb' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Link' }));
  expect(exec).toHaveBeenLastCalledWith(
    'insertHTML',
    false,
    '<a href="https://example.test/kb">example.test/kb</a>',
  );
  expect(screen.queryByLabelText('Link address')).not.toBeInTheDocument();
});

describe('replyLinkHref', () => {
  it('accepts web and mail addresses only', () => {
    expect(replyLinkHref('https://a.test/x')).toBe('https://a.test/x');
    expect(replyLinkHref('a.test')).toBe('https://a.test');
    expect(replyLinkHref('pat@example.test')).toBe('mailto:pat@example.test');
    expect(replyLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(replyLinkHref('data:text/html,x')).toBeUndefined();
    expect(replyLinkHref('has space.test')).toBeUndefined();
  });
});
