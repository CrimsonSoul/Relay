import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readCssBundle } from '../../../styles/readCssBundle.test-util';
import { AlertBodyEditor } from '../AlertBodyEditor';
import { buttonBlockHtml, calloutBlockHtml, dividerBlockHtml, stepBlockHtml } from '../alertBlocks';

// --- Mocks ---

const showToastMock = vi.fn();
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

// jsdom cannot decode images; the stand-in keeps the encoded size proportional to the file so
// the sanitizer bound is still exercised. alertBodyImage.test.ts covers the real downscale.
const prepareAlertBodyImageMock = vi.hoisted(() =>
  vi.fn(
    async (file: Blob) => `data:${file.type};base64,${'A'.repeat(4 * Math.ceil(file.size / 3))}`,
  ),
);
vi.mock('../../../utils/alertBodyImage', () => ({
  prepareAlertBodyImage: prepareAlertBodyImageMock,
}));

vi.mock('../HighlightPopover', () => ({
  HighlightPopover: ({
    onApply,
    onClear,
  }: {
    onApply: (type: string) => void;
    onClear: () => void;
  }) => (
    <div data-testid="highlight-popover">
      <button
        data-testid="apply-highlight"
        onMouseDown={(e) => {
          e.preventDefault();
          onApply('deadline');
        }}
      >
        Apply
      </button>
      <button
        data-testid="clear-highlight"
        onMouseDown={(e) => {
          e.preventDefault();
          onClear();
        }}
      >
        Clear
      </button>
    </div>
  ),
}));

const defaultProps = {
  value: '',
  onChange: vi.fn(),
};

// Stub execCommand and queryCommandState since jsdom does not define them
/* eslint-disable sonarjs/deprecation */
beforeEach(() => {
  document.execCommand = vi.fn().mockReturnValue(true);
  document.queryCommandState = vi.fn().mockReturnValue(false);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      platform: 'darwin',
      selectAlertBodyImage: vi.fn(),
    },
  });
});

describe('AlertBodyEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.execCommand = vi.fn().mockReturnValue(true);
    document.queryCommandState = vi.fn().mockReturnValue(false);
  });
  it('reports encoded images that exceed the sanitizer bound without replacing selected text', async () => {
    render(<AlertBodyEditor {...defaultProps} value="<p>Keep this text</p>" />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const png = new File([new Uint8Array(2 * 1024 * 1024)], 'screen.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [png], getData: () => '' } });
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(expect.stringMatching(/resize|smaller/i), 'error'),
    );
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(editor).toHaveTextContent('Keep this text');
  });

  it('preserves boundaries when pasting div paragraphs', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.paste(screen.getByRole('textbox', { name: 'Alert body' }), {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/html' ? '<div>First</div><div>Second</div>' : '',
      },
    });
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      '<div>First</div><div>Second</div>',
    );
  });

  it('inserts a pasted image file and rejects oversized dropped images', async () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'screen.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [png], getData: () => '' } });
    await waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        expect.stringContaining('data:image/png;base64,'),
      ),
    );
    vi.mocked(document.execCommand).mockClear();
    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    });
    fireEvent.drop(editor, { dataTransfer: { files: [large] } });
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('5 MiB'), 'error'),
    );
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('downscales a pasted image before inserting it', async () => {
    prepareAlertBodyImageMock.mockResolvedValueOnce('data:image/jpeg;base64,U01BTEw=');
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const photo = new File([new Uint8Array(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.paste(editor, { clipboardData: { files: [photo], getData: () => '' } });

    await waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        expect.stringContaining('data:image/jpeg;base64,U01BTEw='),
      ),
    );
    expect(prepareAlertBodyImageMock).toHaveBeenCalledWith(photo);
  });

  it('reports an image that cannot be decoded', async () => {
    prepareAlertBodyImageMock.mockRejectedValueOnce(new Error('decode failed'));
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const png = new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' });
    fireEvent.drop(editor, { dataTransfer: { files: [png] } });

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Could not read this image. Try Insert Image.',
        'error',
      ),
    );
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('pastes the copied text when the clipboard also carries a rendered picture', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const picture = new File([new Uint8Array([137, 80, 78, 71])], 'cells.png', {
      type: 'image/png',
    });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [picture],
        getData: (type: string) =>
          type === 'text/html' ? '<p>Region Status</p>' : 'Region Status',
      },
    });

    expect(prepareAlertBodyImageMock).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      expect.stringContaining('Region'),
    );
  });

  it('renders the body label', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders the contentEditable editor area', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: 'Alert body' })).toBeInTheDocument();
  });

  it('lets the editor grow with text and starts tall enough for the highlight menu', () => {
    const css = readCssBundle('tabs/alerts.css');
    const editableBody = /\.alerts-editable-body\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(editableBody).toContain('min-height: 224px');
    expect(editableBody).toContain('overflow-y: visible');
    expect(editableBody).toContain('flex: 0 0 auto');
  });

  it('starts shorter on short windows so more of the form fits before step 3', () => {
    const css = readCssBundle('tabs/alerts.css');
    const start = css.indexOf('@media (max-height: 900px)');
    const compact = start === -1 ? '' : css.slice(start);
    const compactBody = /\.alerts-editable-body\s*\{[^}]*\}/m.exec(compact)?.[0];

    expect(compactBody).toContain('min-height: 120px');
  });

  it.each([
    ['Bold', 'Bold (⌘B)'],
    ['Italic', 'Italic (⌘I)'],
    ['Underline', 'Underline (⌘U)'],
    ['Bullet List', 'Bullet List'],
    ['Numbered List', 'Numbered List'],
    ['Insert Image', 'Insert Image'],
  ])('shows one tooltip for %s with no native title', (name, tooltip) => {
    render(<AlertBodyEditor {...defaultProps} />);
    const button = screen.getByRole('button', { name });

    expect(button).not.toHaveAttribute('title');
    fireEvent.mouseEnter(button);
    expect(screen.getByText(tooltip)).toBeInTheDocument();
  });

  it('names the platform modifier in the body placeholder and shortcut tooltips', () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { platform: 'win32', selectAlertBodyImage: vi.fn() },
    });
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByText('Bold (Ctrl+B)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Alert body' })).toHaveAttribute(
      'data-placeholder',
      'Write your alert message here. Ctrl+B bold, Ctrl+I italic, Ctrl+U underline.',
    );
  });

  it('exposes toolbar controls with clear accessible labels and pressed states', () => {
    render(<AlertBodyEditor {...defaultProps} />);

    expect(screen.getByRole('toolbar', { name: 'Body formatting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Underline' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Bullet List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Numbered List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert Image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compact message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enhance message' })).not.toBeInTheDocument();
  });

  it('renders highlight popover', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByTestId('highlight-popover')).toBeInTheDocument();
  });

  it('calls onChange on editor input', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.input(editor);
    expect(defaultProps.onChange).toHaveBeenCalled();
  });

  it('synchronizes a new controlled value loaded from history', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AlertBodyEditor {...defaultProps} value="" onChange={onChange} />);

    rerender(
      <AlertBodyEditor
        {...defaultProps}
        value={'<p onclick="alert(1)">History <script>body</script></p>'}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Alert body' })).toHaveProperty(
      'innerHTML',
      '<p>History body</p>',
    );
  });

  it('clears stale editor content when the controlled value is reset', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AlertBodyEditor {...defaultProps} value="<p>Draft body</p>" onChange={onChange} />,
    );
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    editor.innerHTML = '<p>Draft body</p>';

    rerender(<AlertBodyEditor {...defaultProps} value="" onChange={onChange} />);

    expect(editor).toHaveProperty('innerHTML', '');
  });

  it('preserves the caret when ordinary input is echoed through the controlled value', () => {
    const ControlledEditor = () => {
      const [value, setValue] = React.useState('');
      return (
        <>
          <AlertBodyEditor {...defaultProps} value={value} onChange={setValue} />
          <output data-testid="controlled-body-value">{value}</output>
        </>
      );
    };
    render(<ControlledEditor />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    editor.innerHTML = '<div>Draft body</div><div>Next line</div>';
    const text = editor.querySelector('div')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.input(editor);

    expect(screen.getByTestId('controlled-body-value')).toHaveTextContent(
      '<div>Draft body</div><div>Next line</div>',
    );
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(5);
  });

  it('sets editor content from its controlled value', () => {
    render(<AlertBodyEditor {...defaultProps} value="<p>New content</p>" />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    expect(editor.innerHTML).toBe('<p>New content</p>');
  });

  it.each([
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Underline', 'underline'],
    ['Bullet List', 'insertUnorderedList'],
    ['Numbered List', 'insertOrderedList'],
  ])('applies %s formatting on mouseDown', (buttonName, command) => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: buttonName }));
    expect(document.execCommand).toHaveBeenCalledWith(command);
  });

  it.each([
    ['Bullet List', 'insertUnorderedList'],
    ['Numbered List', 'insertOrderedList'],
  ])('applies %s formatting from the keyboard', (buttonName, command) => {
    render(<AlertBodyEditor {...defaultProps} />);
    // Enter/Space on a focused button dispatches click with detail 0 and never mousedown,
    // so a mousedown-only toolbar is unreachable without a mouse.
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    expect(document.execCommand).toHaveBeenCalledWith(command);
  });

  it('inserts an alert image from the keyboard', async () => {
    const bridge = window.api as NonNullable<typeof window.api>;
    vi.mocked(bridge.selectAlertBodyImage).mockResolvedValue({ success: true, data: 'data:img' });

    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Image' }));

    await vi.waitFor(() => {
      expect(bridge.selectAlertBodyImage).toHaveBeenCalled();
    });
  });

  it('applies a toolbar command once for a real mouse press', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Bullet List' });

    // A mouse press fires mousedown then click; only one of them may run the command
    fireEvent.mouseDown(button);
    fireEvent.click(button, { detail: 1 });

    expect(document.execCommand).toHaveBeenCalledTimes(1);
  });

  it('selects and inserts an alert image block through the toolbar', async () => {
    const selectedImage = 'data:image/jpeg;base64,SEL';
    const bridge = window.api as NonNullable<typeof window.api>;
    vi.mocked(bridge.selectAlertBodyImage).mockResolvedValue({
      success: true,
      data: selectedImage,
    });

    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert Image' }));

    await vi.waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        `<figure class="alert-body-figure"><img src="${selectedImage}" alt="Alert image" class="alert-body-image"><figcaption></figcaption></figure><p><br></p>`,
      );
    });
    expect(defaultProps.onChange).toHaveBeenCalled();
  });

  it('does nothing when image selection is cancelled', async () => {
    const bridge = window.api as NonNullable<typeof window.api>;
    let resolveSelection!: (result: { success: boolean; error: string }) => void;
    const selection = new Promise<{ success: boolean; error: string }>((resolve) => {
      resolveSelection = resolve;
    });
    vi.mocked(bridge.selectAlertBodyImage).mockReturnValue(selection);

    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert Image' }));

    expect(bridge.selectAlertBodyImage).toHaveBeenCalled();
    await act(async () => {
      resolveSelection({ success: false, error: 'Cancelled' });
    });

    expect(document.execCommand).not.toHaveBeenCalledWith(
      'insertHTML',
      false,
      expect.stringContaining('<img'),
    );
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('surfaces image selection errors as a toast', async () => {
    const bridge = window.api as NonNullable<typeof window.api>;
    vi.mocked(bridge.selectAlertBodyImage).mockResolvedValue({
      success: false,
      error: 'Image must be under 5MB',
    });

    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert Image' }));

    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('Image must be under 5MB', 'error');
    });
    expect(document.execCommand).not.toHaveBeenCalledWith(
      'insertHTML',
      false,
      expect.stringContaining('<img'),
    );
  });

  it('handles paste with HTML content', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? '<p>Pasted HTML</p>' : 'Pasted text'),
      },
    });

    expect(document.execCommand).toHaveBeenCalledWith('insertHTML', false, '<p>Pasted HTML</p>');
  });

  it('handles paste with plain text only', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? '' : 'Plain text\nwith newline'),
      },
    });

    expect(document.execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      'Plain text<br>with newline',
    );
  });

  it.each([
    ['Cmd+1 highlight', { key: '1', metaKey: true }],
    ['Cmd+0 clear', { key: '0', metaKey: true }],
    ['unmodified key', { key: '1' }],
    ['Ctrl shortcut', { key: '2', ctrlKey: true }],
  ])('handles the %s keydown path without crashing', (_case, init) => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, init);
    expect(editor).toBeInTheDocument();
  });

  it.each([
    ['highlight', { key: '1', metaKey: true }],
    ['clear highlight', { key: '0', ctrlKey: true }],
  ])('keeps the handled %s shortcut inside the editor', (_case, init) => {
    const globalKeydown = vi.fn();
    globalThis.addEventListener('keydown', globalKeydown);
    render(<AlertBodyEditor {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Alert body' }), init);

    expect(globalKeydown).not.toHaveBeenCalled();
    globalThis.removeEventListener('keydown', globalKeydown);
  });

  it('does not add active class when formats are inactive', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const boldBtn = screen.getByRole('button', { name: 'Bold' });
    expect(boldBtn.className).not.toContain('active');
  });

  it('calls applyHighlight via popover onApply (no selection is a no-op)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    // Clicking apply without a selection should not crash
    fireEvent.mouseDown(screen.getByTestId('apply-highlight'));
    // With no selection, onChange is not called
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('calls clearHighlight via popover onClear (no highlight node is a no-op)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    // Clicking clear without any highlighted node should not crash
    fireEvent.mouseDown(screen.getByTestId('clear-highlight'));
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('applies highlight across mixed formatted and plain text selections', () => {
    render(<AlertBodyEditor {...defaultProps} value="<b>Bold</b> text" />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const boldText = editor.querySelector('b')!.firstChild!;
    const plainText = editor.childNodes[1]!;
    const range = document.createRange();
    range.setStart(boldText, 2);
    range.setEnd(plainText, 3);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('apply-highlight'));

    expect(editor.innerHTML).toBe('<b>Bo</b><span data-hl="deadline"><b>ld</b> te</span>xt');
    expect(defaultProps.onChange).toHaveBeenCalledWith(
      '<b>Bo</b><span data-hl="deadline"><b>ld</b> te</span>xt',
    );
  });

  it('replaces existing highlights inside the selected content', () => {
    render(<AlertBodyEditor {...defaultProps} value={'<span data-hl="warning">Old</span> text'} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const highlightedText = editor.querySelector('[data-hl="warning"]')!.firstChild!;
    const plainText = editor.childNodes[1]!;
    const range = document.createRange();
    range.setStart(highlightedText, 0);
    range.setEnd(plainText, 3);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('apply-highlight'));

    expect(editor.innerHTML).toBe('<span data-hl="deadline">Old te</span>xt');
    expect(defaultProps.onChange).toHaveBeenCalledWith('<span data-hl="deadline">Old te</span>xt');
  });

  it('replaces the current highlight instead of nesting when selection is inside one', () => {
    render(<AlertBodyEditor {...defaultProps} value={'<span data-hl="warning">Old</span> text'} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const highlightedText = editor.querySelector('[data-hl="warning"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(highlightedText, 0);
    range.setEnd(highlightedText, 3);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('apply-highlight'));

    expect(editor.innerHTML).toBe('<span data-hl="deadline">Old</span> text');
    expect(defaultProps.onChange).toHaveBeenCalledWith('<span data-hl="deadline">Old</span> text');
  });

  it('splits an existing highlight around a newly selected highlight', () => {
    render(<AlertBodyEditor {...defaultProps} value={'<span data-hl="warning">ABCDE</span>'} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const highlightedText = editor.querySelector('[data-hl="warning"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(highlightedText, 1);
    range.setEnd(highlightedText, 3);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('apply-highlight'));

    expect(editor.innerHTML).toBe(
      '<span data-hl="warning">A</span><span data-hl="deadline">BC</span><span data-hl="warning">DE</span>',
    );
    expect(defaultProps.onChange).toHaveBeenCalledWith(
      '<span data-hl="warning">A</span><span data-hl="deadline">BC</span><span data-hl="warning">DE</span>',
    );
  });

  it('clears highlight when the selection is inside nested formatted content', () => {
    render(
      <AlertBodyEditor
        {...defaultProps}
        value={'<span data-hl="deadline"><b>Nested</b></span> highlight'}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const nestedText = editor.querySelector('b')!.firstChild!;
    const range = document.createRange();
    range.setStart(nestedText, 1);
    range.setEnd(nestedText, 3);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('clear-highlight'));

    expect(editor.innerHTML).toBe('<b>Nested</b> highlight');
    expect(defaultProps.onChange).toHaveBeenCalledWith('<b>Nested</b> highlight');
  });

  it('clears all highlights touched by a selected range', () => {
    render(
      <AlertBodyEditor
        {...defaultProps}
        value={
          '<span data-hl="warning">A</span><span data-hl="deadline">BC</span><span data-hl="warning">DE</span>'
        }
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    const highlights = editor.querySelectorAll('[data-hl]');
    expect(highlights).toHaveLength(3);
    const range = document.createRange();
    range.setStart(highlights[0]!.firstChild!, 0);
    range.setEnd(highlights[2]!.firstChild!, 2);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseDown(screen.getByTestId('clear-highlight'));

    expect(editor.innerHTML).toBe('ABCDE');
    expect(defaultProps.onChange).toHaveBeenCalledWith('ABCDE');
  });

  it.each([
    ['Ctrl+3 highlight', { key: '3', ctrlKey: true }],
    ['Cmd+4 highlight', { key: '4', metaKey: true }],
    ['Cmd+5 highlight', { key: '5', metaKey: true }],
    ['Cmd+6 out-of-range', { key: '6', metaKey: true }],
    ['Cmd+9 out-of-range', { key: '9', metaKey: true }],
  ])('handles the %s keydown path without crashing', (_case, init) => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, init);
    expect(editor).toBeInTheDocument();
  });

  it('updates active formats on selectionchange when editor is focused', () => {
    document.queryCommandState = vi.fn().mockReturnValue(true);
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });

    // Actually focus the editor DOM element so document.activeElement is the editor
    act(() => {
      editor.focus();
      document.dispatchEvent(new Event('selectionchange'));
    });

    // The bold/italic/underline buttons should now have active class
    const boldBtn = screen.getByRole('button', { name: 'Bold' });
    expect(boldBtn.className).toContain('active');
  });

  it('does not update formats on selectionchange when editor is not focused', () => {
    document.queryCommandState = vi.fn().mockReturnValue(true);
    render(<AlertBodyEditor {...defaultProps} />);

    // Do NOT focus the editor — activeElement is body
    document.dispatchEvent(new Event('selectionchange'));

    // Bold button should not have active class because editor is not the active element
    const boldBtn = screen.getByRole('button', { name: 'Bold' });
    expect(boldBtn.className).not.toContain('active');
  });
  describe('guide authoring', () => {
    const selectEditorText = (text: string) => {
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = `<p>${text}</p>`;
      const range = document.createRange();
      range.selectNodeContents(editor.querySelector('p')!);
      const selection = globalThis.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return editor;
    };

    it('toggles the current block to a heading', () => {
      document.queryCommandValue = vi.fn().mockReturnValue('p');
      render(<AlertBodyEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2');

      vi.mocked(document.execCommand).mockClear();
      document.queryCommandValue = vi.fn().mockReturnValue('h2');
      fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, 'p');
    });

    it('applies a sanitized link to the selection', () => {
      render(<AlertBodyEditor {...defaultProps} />);
      selectEditorText('help page');
      fireEvent.click(screen.getByRole('button', { name: 'Insert Link' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Link address' }), {
        target: { value: 'example.test/help' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Link' }));
      expect(document.execCommand).toHaveBeenCalledWith(
        'createLink',
        false,
        'https://example.test/help',
      );
    });

    it('shows a field error for a non-http link and applies nothing', () => {
      render(<AlertBodyEditor {...defaultProps} />);
      selectEditorText('help page');
      fireEvent.click(screen.getByRole('button', { name: 'Insert Link' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Link address' }), {
        target: { value: 'mailto:ops@example.test' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Link' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Enter an HTTP or HTTPS address');
      expect(document.execCommand).not.toHaveBeenCalledWith(
        'createLink',
        expect.anything(),
        expect.anything(),
      );
    });

    const placeCaretIn = (node: Node) => {
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      const selection = globalThis.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };

    const chooseInsert = (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
    };

    const lastEmitted = (onChange: ReturnType<typeof vi.fn>) =>
      onChange.mock.calls.at(-1)?.[0] as string;

    it('lists the guide blocks in the Insert menu', () => {
      render(<AlertBodyEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Step',
        'Note',
        'Warning',
        'Success',
        'Divider',
        'Button Link',
      ]);
    });

    it('inserts a step after the block holding the caret', () => {
      const onChange = vi.fn();
      render(<AlertBodyEditor value="" onChange={onChange} />);
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = '<p>Intro</p><p>Outro</p>';
      placeCaretIn(editor.querySelector('p')!.firstChild!);

      chooseInsert('Step');

      expect(lastEmitted(onChange)).toBe(`<p>Intro</p>${stepBlockHtml()}<p>Outro</p>`);
      expect(lastEmitted(onChange)).not.toContain('Step title');
      expect(globalThis.getSelection()!.anchorNode).toBe(editor.querySelector('h3'));
    });

    it('inserts callouts and a divider at the end when the caret is elsewhere', () => {
      const onChange = vi.fn();
      render(<AlertBodyEditor value="" onChange={onChange} />);
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = '<p>Intro</p>';
      globalThis.getSelection()!.removeAllRanges();

      chooseInsert('Warning');
      expect(lastEmitted(onChange)).toBe(`<p>Intro</p>${calloutBlockHtml('warning')}<p><br></p>`);

      globalThis.getSelection()!.removeAllRanges();
      chooseInsert('Divider');
      expect(lastEmitted(onChange)).toContain(`<p><br></p>${dividerBlockHtml()}<p><br></p>`);
    });

    it('puts an inserted image inside the step holding the caret', async () => {
      const bridge = window.api as NonNullable<typeof window.api>;
      vi.mocked(bridge.selectAlertBodyImage).mockResolvedValue({
        success: true,
        data: 'data:image/png;base64,U1RFUA==',
      });
      const onChange = vi.fn();
      render(<AlertBodyEditor value="" onChange={onChange} />);
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = stepBlockHtml('Sign in', '<p>First</p><p>Second</p>');
      placeCaretIn(editor.querySelector('[data-relay-block="step"] p')!.firstChild!);

      fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert Image' }));

      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const step = editor.querySelector('[data-relay-block="step"]')!;
      expect(Array.from(step.children, (child) => child.tagName)).toEqual([
        'H3',
        'P',
        'FIGURE',
        'P',
      ]);
      expect(document.execCommand).not.toHaveBeenCalledWith(
        'insertHTML',
        expect.anything(),
        expect.anything(),
      );
    });

    it('inserts a button link with a label', () => {
      const onChange = vi.fn();
      render(<AlertBodyEditor value="" onChange={onChange} />);
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = '<p>Intro</p>';
      placeCaretIn(editor.querySelector('p')!.firstChild!);

      chooseInsert('Button Link');
      fireEvent.change(screen.getByRole('textbox', { name: 'Button label' }), {
        target: { value: 'Open portal' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Link address' }), {
        target: { value: 'example.test/portal' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Insert Button' }));

      expect(lastEmitted(onChange)).toBe(
        `<p>Intro</p>${buttonBlockHtml('https://example.test/portal', 'Open portal')}<p><br></p>`,
      );
    });

    const renderGuide = (bodyHtml: string) => {
      const onChange = vi.fn();
      render(<AlertBodyEditor value="" onChange={onChange} />);
      const editor = screen.getByRole('textbox', { name: 'Alert body' });
      editor.innerHTML = bodyHtml;
      const caretInto = (node: Node) => {
        placeCaretIn(node);
        act(() => {
          document.dispatchEvent(new Event('selectionchange'));
        });
      };
      return { editor, onChange, caretInto };
    };

    const stepTitles = (html: string) =>
      Array.from(html.matchAll(/<h3>([^<]*)<\/h3>/g), (match) => match[1]);

    it('shows step controls for the step holding the caret', () => {
      const { editor, caretInto } = renderGuide(`${stepBlockHtml('A')}${stepBlockHtml('B')}`);
      caretInto(editor.querySelector('h3')!.firstChild!);

      expect(screen.getByRole('button', { name: 'Move Up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Down' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Remove Step' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    });

    it('shows only Remove for a callout', () => {
      const { editor, caretInto } = renderGuide(calloutBlockHtml('note', '<p>Heads up</p>'));
      caretInto(editor.querySelector('p')!.firstChild!);

      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Move Up' })).toBeNull();
    });

    it('moves a step down and announces it', () => {
      const { editor, onChange, caretInto } = renderGuide(
        `${stepBlockHtml('A')}<p>Between</p>${stepBlockHtml('B')}`,
      );
      caretInto(editor.querySelector('h3')!.firstChild!);

      fireEvent.click(screen.getByRole('button', { name: 'Move Down' }));

      expect(stepTitles(lastEmitted(onChange))).toEqual(['B', 'A']);
      expect(lastEmitted(onChange)).toContain('<p>Between</p>');
      expect(screen.getByRole('status')).toHaveTextContent('Moved step 1 to step 2');
    });

    it('moves a step up with Ctrl+Alt+ArrowUp', () => {
      const { editor, onChange, caretInto } = renderGuide(
        `${stepBlockHtml('A')}${stepBlockHtml('B')}`,
      );
      caretInto(editor.querySelectorAll('h3')[1]!.firstChild!);

      fireEvent.keyDown(editor, { key: 'ArrowUp', ctrlKey: true, altKey: true });

      expect(stepTitles(lastEmitted(onChange))).toEqual(['B', 'A']);
      expect(screen.getByRole('status')).toHaveTextContent('Moved step 2 to step 1');
    });

    it('removes a step from its toolbar and announces it', () => {
      const { editor, onChange, caretInto } = renderGuide(
        `${stepBlockHtml('A')}${stepBlockHtml('B')}`,
      );
      caretInto(editor.querySelectorAll('h3')[1]!.firstChild!);

      fireEvent.click(screen.getByRole('button', { name: 'Remove Step' }));

      expect(stepTitles(lastEmitted(onChange))).toEqual(['A']);
      expect(screen.getByRole('status')).toHaveTextContent('Removed step 2');
    });

    it('removes an empty step on the second Backspace', () => {
      const { editor, onChange, caretInto } = renderGuide(`<p>Intro</p>${stepBlockHtml()}`);
      caretInto(editor.querySelector('h3')!);

      fireEvent.keyDown(editor, { key: 'Backspace' });
      expect(editor.querySelector('[data-relay-block="step"]')).not.toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Press Backspace again to remove this step',
      );

      fireEvent.keyDown(editor, { key: 'Backspace' });
      expect(editor.querySelector('[data-relay-block="step"]')).toBeNull();
      expect(lastEmitted(onChange)).toBe('<p>Intro</p>');
    });

    it('cancels a pending removal when another key is pressed', () => {
      const { editor, caretInto } = renderGuide(calloutBlockHtml('warning'));
      caretInto(editor.querySelector('p')!);

      fireEvent.keyDown(editor, { key: 'Backspace' });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Press Backspace again to remove this block',
      );
      fireEvent.keyDown(editor, { key: 'a' });
      fireEvent.keyDown(editor, { key: 'Backspace' });

      expect(editor.querySelector('[data-relay-block="callout"]')).not.toBeNull();
    });

    it('leaves Backspace alone in a step that has text', () => {
      const { editor, caretInto } = renderGuide(stepBlockHtml('A', '<p>Body</p>'));
      caretInto(editor.querySelector('p')!.firstChild!);

      const event = fireEvent.keyDown(editor, { key: 'Backspace' });

      expect(event).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent('');
    });

    it('moves from a step title to its first paragraph on Enter', () => {
      const { editor, caretInto } = renderGuide(stepBlockHtml('Title', ''));
      caretInto(editor.querySelector('h3')!.firstChild!);

      fireEvent.keyDown(editor, { key: 'Enter' });

      const step = editor.querySelector('[data-relay-block="step"]')!;
      expect(step.innerHTML).toBe('<h3>Title</h3><p><br></p>');
      expect(globalThis.getSelection()!.anchorNode).toBe(step.querySelector('p'));
    });

    it('wraps inserted images in a figure with an empty caption', async () => {
      render(<AlertBodyEditor {...defaultProps} />);
      const png = new File([new Uint8Array([137, 80, 78, 71])], 'step.png', {
        type: 'image/png',
      });
      fireEvent.paste(screen.getByRole('textbox', { name: 'Alert body' }), {
        clipboardData: { files: [png], getData: () => '' },
      });
      await waitFor(() =>
        expect(document.execCommand).toHaveBeenCalledWith(
          'insertHTML',
          false,
          expect.stringMatching(
            /^<figure class="alert-body-figure"><img src="data:image\/png;base64,[^"]+" alt="Alert image" class="alert-body-image"><figcaption><\/figcaption><\/figure><p><br><\/p>$/,
          ),
        ),
      );
    });
  });
});
