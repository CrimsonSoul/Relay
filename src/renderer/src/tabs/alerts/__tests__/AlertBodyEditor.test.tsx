import React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertBodyEditor } from '../AlertBodyEditor';

// --- Mocks ---

const showToastMock = vi.fn();
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: showToastMock }),
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

  it('renders the body label', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders the contentEditable editor area', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: 'Alert body' })).toBeInTheDocument();
  });

  it('lets the editor grow with text and starts tall enough for the highlight menu', () => {
    const css = readFileSync('src/renderer/src/tabs/alerts.css', 'utf8');
    const editableBody = /\.alerts-editable-body\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(editableBody).toContain('min-height: 224px');
    expect(editableBody).toContain('overflow-y: visible');
    expect(editableBody).toContain('flex: 0 0 auto');
  });

  it('renders formatting buttons (Bold, Italic, Underline)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByTitle('Bold (Cmd+B)')).toBeInTheDocument();
    expect(screen.getByTitle('Italic (Cmd+I)')).toBeInTheDocument();
    expect(screen.getByTitle('Underline (Cmd+U)')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compact message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enhance message' })).not.toBeInTheDocument();
  });

  it('renders list formatting buttons', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByTitle('Bullet List')).toBeInTheDocument();
    expect(screen.getByTitle('Numbered List')).toBeInTheDocument();
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
    editor.innerHTML = '<p>Draft body</p>';
    const text = editor.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const selection = globalThis.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.input(editor);

    expect(screen.getByTestId('controlled-body-value')).toHaveTextContent('<p>Draft body</p>');
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(5);
  });

  it('sets editor content from its controlled value', () => {
    render(<AlertBodyEditor {...defaultProps} value="<p>New content</p>" />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    expect(editor.innerHTML).toBe('<p>New content</p>');
  });

  it.each([
    ['Bold (Cmd+B)', 'bold'],
    ['Italic (Cmd+I)', 'italic'],
    ['Underline (Cmd+U)', 'underline'],
    ['Bullet List', 'insertUnorderedList'],
    ['Numbered List', 'insertOrderedList'],
  ])('applies %s formatting on mouseDown', (buttonTitle, command) => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle(buttonTitle));
    expect(document.execCommand).toHaveBeenCalledWith(command);
  });

  it.each([
    ['Bullet list', 'insertUnorderedList'],
    ['Numbered list', 'insertOrderedList'],
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
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));

    await vi.waitFor(() => {
      expect(bridge.selectAlertBodyImage).toHaveBeenCalled();
    });
  });

  it('applies a toolbar command once for a real mouse press', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Bullet list' });

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
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert image' }));

    await vi.waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        `<p><img src="${selectedImage}" alt="Alert image" class="alert-body-image"></p>`,
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
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert image' }));

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
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insert image' }));

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

  it('does not add active class when formats are inactive', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const boldBtn = screen.getByTitle('Bold (Cmd+B)');
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
    const boldBtn = screen.getByTitle('Bold (Cmd+B)');
    expect(boldBtn.className).toContain('active');
  });

  it('does not update formats on selectionchange when editor is not focused', () => {
    document.queryCommandState = vi.fn().mockReturnValue(true);
    render(<AlertBodyEditor {...defaultProps} />);

    // Do NOT focus the editor — activeElement is body
    document.dispatchEvent(new Event('selectionchange'));

    // Bold button should not have active class because editor is not the active element
    const boldBtn = screen.getByTitle('Bold (Cmd+B)');
    expect(boldBtn.className).not.toContain('active');
  });
});
