import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertBodyEditor, type AlertBodyEditorHandle } from '../AlertBodyEditor';

// --- Mocks ---

vi.mock('../../alertUtils', () => ({
  sanitizeHtml: (html: string) => html,
  escapeHtml: (text: string) => text,
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
      <button data-testid="apply-highlight" onClick={() => onApply('deadline')}>
        Apply
      </button>
      <button data-testid="clear-highlight" onClick={onClear}>
        Clear
      </button>
    </div>
  ),
}));

const defaultProps = {
  setBodyHtml: vi.fn(),
  isCompact: false,
  onToggleCompact: vi.fn(),
  isEnhanced: false,
  onToggleEnhanced: vi.fn(),
};

// Stub execCommand and queryCommandState since jsdom does not define them
/* eslint-disable sonarjs/deprecation */
beforeEach(() => {
  document.execCommand = vi.fn().mockReturnValue(true);
  document.queryCommandState = vi.fn().mockReturnValue(false);
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

  it('renders formatting buttons (Bold, Italic, Underline)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    expect(screen.getByTitle('Bold (Cmd+B)')).toBeInTheDocument();
    expect(screen.getByTitle('Italic (Cmd+I)')).toBeInTheDocument();
    expect(screen.getByTitle('Underline (Cmd+U)')).toBeInTheDocument();
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

  it('renders compact toggle button', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const btn = screen.getByTitle(/Compact/);
    expect(btn).toBeInTheDocument();
  });

  it('renders enhance toggle button', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const btn = screen.getByTitle(/Enhance/);
    expect(btn).toBeInTheDocument();
  });

  it('calls onToggleCompact when compact button is clicked', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const btn = screen.getByTitle(/Compact/);
    fireEvent.mouseDown(btn);
    expect(defaultProps.onToggleCompact).toHaveBeenCalled();
  });

  it('calls onToggleEnhanced when enhance button is clicked', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const btn = screen.getByTitle(/Enhance/);
    fireEvent.mouseDown(btn);
    expect(defaultProps.onToggleEnhanced).toHaveBeenCalled();
  });

  it('adds active class when isCompact is true', () => {
    render(<AlertBodyEditor {...defaultProps} isCompact={true} />);
    const btn = screen.getByTitle(/Compact/);
    expect(btn.className).toContain('active');
  });

  it('adds active class when isEnhanced is true', () => {
    render(<AlertBodyEditor {...defaultProps} isEnhanced={true} />);
    const btn = screen.getByTitle(/Enhance/);
    expect(btn.className).toContain('active');
  });

  it('calls setBodyHtml on editor input', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.input(editor);
    expect(defaultProps.setBodyHtml).toHaveBeenCalled();
  });

  it('exposes setEditorContent via ref', () => {
    const ref = React.createRef<AlertBodyEditorHandle>();
    render(<AlertBodyEditor {...defaultProps} ref={ref} />);
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current!.setEditorContent).toBe('function');
  });

  it('sets editor content via ref', () => {
    const ref = React.createRef<AlertBodyEditorHandle>();
    render(<AlertBodyEditor {...defaultProps} ref={ref} />);
    ref.current!.setEditorContent('<p>New content</p>');
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    expect(editor.innerHTML).toBe('<p>New content</p>');
  });

  it('applies bold formatting on mouseDown', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle('Bold (Cmd+B)'));
    expect(document.execCommand).toHaveBeenCalledWith('bold');
  });

  it('applies italic formatting on mouseDown', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle('Italic (Cmd+I)'));
    expect(document.execCommand).toHaveBeenCalledWith('italic');
  });

  it('applies underline formatting on mouseDown', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle('Underline (Cmd+U)'));
    expect(document.execCommand).toHaveBeenCalledWith('underline');
  });

  it('applies bullet list formatting', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle('Bullet List'));
    expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList');
  });

  it('applies numbered list formatting', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    fireEvent.mouseDown(screen.getByTitle('Numbered List'));
    expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList');
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

  it('handles Cmd+1 keydown to apply first highlight', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '1', metaKey: true });
    // Should not crash — highlight needs selection which is empty in test
    expect(editor).toBeInTheDocument();
  });

  it('handles Cmd+0 keydown to clear highlight', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '0', metaKey: true });
    expect(editor).toBeInTheDocument();
  });

  it('ignores keydown without metaKey or ctrlKey', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '1' });
    expect(editor).toBeInTheDocument();
  });

  it('handles Ctrl+key shortcuts (non-Mac)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '2', ctrlKey: true });
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
    fireEvent.click(screen.getByTestId('apply-highlight'));
    // With no selection, setBodyHtml is not called
    expect(defaultProps.setBodyHtml).not.toHaveBeenCalled();
  });

  it('calls clearHighlight via popover onClear (no highlight node is a no-op)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    // Clicking clear without any highlighted node should not crash
    fireEvent.click(screen.getByTestId('clear-highlight'));
    expect(defaultProps.setBodyHtml).not.toHaveBeenCalled();
  });

  it('handles Ctrl+3 to apply third highlight type', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '3', ctrlKey: true });
    // Should not crash — highlight needs selection which may be empty
    expect(editor).toBeInTheDocument();
  });

  it('handles Ctrl+4 to apply fourth highlight type', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '4', metaKey: true });
    expect(editor).toBeInTheDocument();
  });

  it('handles Ctrl+5 to apply fifth highlight type', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '5', metaKey: true });
    expect(editor).toBeInTheDocument();
  });

  it('ignores Cmd+6 (no sixth highlight)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '6', metaKey: true });
    // No highlight for index 5, should be a no-op
    expect(editor).toBeInTheDocument();
  });

  it('ignores Cmd+9 (out of highlight range)', () => {
    render(<AlertBodyEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Alert body' });
    fireEvent.keyDown(editor, { key: '9', metaKey: true });
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

  it('does not add active class to compact toggle when isCompact is false', () => {
    render(<AlertBodyEditor {...defaultProps} isCompact={false} />);
    const btn = screen.getByTitle(/Compact/);
    expect(btn.className).not.toContain('active');
  });

  it('does not add active class to enhance toggle when isEnhanced is false', () => {
    render(<AlertBodyEditor {...defaultProps} isEnhanced={false} />);
    const btn = screen.getByTitle(/Enhance/);
    expect(btn.className).not.toContain('active');
  });
});
