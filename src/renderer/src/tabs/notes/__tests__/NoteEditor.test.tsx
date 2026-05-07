import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NoteEditor } from '../NoteEditor';
import type { StandaloneNote, NoteColor } from '@shared/ipc';

type MockTactileButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
};

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});

vi.mock('../../../components/TactileButton', () => ({
  TactileButton: ({ children, onClick, disabled, ...props }: MockTactileButtonProps) => (
    <button onClick={onClick} disabled={disabled} data-variant={props.variant}>
      {children}
    </button>
  ),
}));

vi.mock('../../../hooks/useNotepad', () => ({
  NOTE_COLORS: [
    { value: 'amber', label: 'Amber', hex: '#e11d48' },
    { value: 'blue', label: 'Blue', hex: '#3b82f6' },
  ],
}));

const mockNote: StandaloneNote = {
  id: 'note-1',
  title: 'Existing Title',
  content: 'Existing content',
  color: 'blue' as NoteColor,
  tags: ['react', 'testing'],
  createdAt: Date.now() - 120000,
  updatedAt: Date.now() - 60000,
};

const defaultProps = () => ({
  isOpen: true,
  note: undefined as StandaloneNote | undefined,
  onSave: vi.fn(),
  onClose: vi.fn(),
  onDelete: undefined as (() => void) | undefined,
});

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Does not render when isOpen is false
  it('does not render anything when isOpen is false', () => {
    const props = defaultProps();
    props.isOpen = false;
    const { container } = render(<NoteEditor {...props} />);
    expect(container.innerHTML).toBe('');
  });

  // 2. Renders form when isOpen is true
  it('renders form elements when isOpen is true', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    expect(screen.getByPlaceholderText('Note title...')).toBeTruthy();
    expect(screen.getByPlaceholderText('Write something...')).toBeTruthy();
    expect(screen.getByPlaceholderText('Add tags...')).toBeTruthy();
    expect(screen.getByText('Color')).toBeTruthy();
    // Color swatches
    expect(screen.getByLabelText('Amber')).toBeTruthy();
    expect(screen.getByLabelText('Blue')).toBeTruthy();
  });

  // 3. Editing existing note: pre-fills form with note data
  it('pre-fills form with note data when editing an existing note', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    render(<NoteEditor {...props} />);
    const titleInput = screen.getByPlaceholderText('Note title...') as HTMLInputElement;
    const contentInput = screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement;
    expect(titleInput.value).toBe('Existing Title');
    expect(contentInput.value).toBe('Existing content');
    expect(screen.getByText('react')).toBeTruthy();
    expect(screen.getByText('testing')).toBeTruthy();
  });

  it('shows "Save" button text when editing existing note', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    const { container } = render(<NoteEditor {...props} />);
    const primaryBtn = container.querySelector('button[data-variant="primary"]');
    expect(primaryBtn?.textContent).toBe('Save');
  });

  // 4. Creating new note: shows empty form, button says "Create"
  it('shows "Create" button text for new note', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    expect(screen.getByText('Create')).toBeTruthy();
  });

  it('shows empty fields for new note', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const titleInput = screen.getByPlaceholderText('Note title...') as HTMLInputElement;
    const contentInput = screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement;
    expect(titleInput.value).toBe('');
    expect(contentInput.value).toBe('');
  });

  // 5. Save: calls onSave with trimmed values
  it('calls onSave with trimmed values when save is clicked', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: '  My Title  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Write something...'), {
      target: { value: '  My content  ' },
    });
    fireEvent.click(screen.getByText('Create'));

    expect(props.onSave).toHaveBeenCalledWith({
      title: 'My Title',
      content: 'My content',
      color: 'amber',
      tags: [],
    });
  });

  // 6. Save disabled when both title and content empty
  it('does not call onSave when both title and content are empty', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.click(screen.getByText('Create'));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('enables save button when title has text', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: 'Title' },
    });
    const createBtn = screen.getByText('Create');
    expect(createBtn.hasAttribute('disabled')).toBe(false);
  });

  it('enables save button when content has text but title is empty', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Write something...'), {
      target: { value: 'Content' },
    });
    const createBtn = screen.getByText('Create');
    expect(createBtn.hasAttribute('disabled')).toBe(false);
  });

  it('does not call onSave when both title and content are whitespace only', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Write something...'), {
      target: { value: '   ' },
    });
    // Manually trigger save via keyboard shortcut (bypasses disabled button)
    fireEvent.keyDown(document.querySelector('.note-editor-inner')!, {
      key: 'Enter',
      metaKey: true,
    });
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // 7. Cancel: calls onClose
  it('calls onClose when Cancel is clicked', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a compact close control when rendered as a panel', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} variant="panel" />);
    expect(screen.getByLabelText('Close')).toHaveClass('note-editor-close--panel');
  });

  // 8. Delete: button only shown when note exists AND onDelete provided
  it('does not show delete button when creating a new note', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('does not show delete button when note exists but onDelete is not provided', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    props.onDelete = undefined;
    render(<NoteEditor {...props} />);
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('shows delete button when note exists and onDelete is provided', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    props.onDelete = vi.fn();
    render(<NoteEditor {...props} />);
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onDelete when delete button is clicked', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    props.onDelete = vi.fn();
    render(<NoteEditor {...props} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  // 9. Tags: Enter adds tag, comma adds tag, Backspace removes last, duplicate prevented
  it('adds a tag when Enter is pressed in tag input', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const tagInput = screen.getByPlaceholderText('Add tags...');
    fireEvent.change(tagInput, { target: { value: 'newtag' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByText('newtag')).toBeTruthy();
  });

  it('adds a tag when comma is pressed in tag input', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const tagInput = screen.getByPlaceholderText('Add tags...');
    fireEvent.change(tagInput, { target: { value: 'commtag' } });
    fireEvent.keyDown(tagInput, { key: ',' });
    expect(screen.getByText('commtag')).toBeTruthy();
  });

  it('clears tag input after adding a tag', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const tagInput = screen.getByPlaceholderText('Add tags...') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'sometag' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(tagInput.value).toBe('');
  });

  it('converts tag to lowercase', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const tagInput = screen.getByPlaceholderText('Add tags...');
    fireEvent.change(tagInput, { target: { value: 'MyTag' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByText('mytag')).toBeTruthy();
  });

  it('prevents duplicate tags', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    const tagInput = screen.getByPlaceholderText('Add tags...');

    // Add the tag the first time
    fireEvent.change(tagInput, { target: { value: 'dup' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // Try to add same tag again
    fireEvent.change(tagInput, { target: { value: 'dup' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // Should only appear once
    const tags = screen.getAllByText('dup');
    expect(tags.length).toBe(1);
  });

  it('removes last tag on Backspace when input is empty', () => {
    const props = defaultProps();
    props.note = { ...mockNote, tags: ['first', 'second'] };
    render(<NoteEditor {...props} />);

    // Both tags shown
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();

    // Tag input should be empty (placeholder won't show since there are tags)
    const tagInput = document.querySelector('.note-editor-tag-input') as HTMLInputElement;
    expect(tagInput.value).toBe('');

    // Press Backspace to remove last tag
    fireEvent.keyDown(tagInput, { key: 'Backspace' });
    expect(screen.queryByText('second')).toBeNull();
    expect(screen.getByText('first')).toBeTruthy();
  });

  it('does not remove tag on Backspace when input has text', () => {
    const props = defaultProps();
    props.note = { ...mockNote, tags: ['keeptag'] };
    render(<NoteEditor {...props} />);

    const tagInput = document.querySelector('.note-editor-tag-input') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'x' } });
    fireEvent.keyDown(tagInput, { key: 'Backspace' });
    expect(screen.getByText('keeptag')).toBeTruthy();
  });

  it('removes a specific tag when its remove button is clicked', () => {
    const props = defaultProps();
    props.note = { ...mockNote, tags: ['alpha', 'beta'] };
    render(<NoteEditor {...props} />);
    fireEvent.click(screen.getByLabelText('Remove tag alpha'));
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  // 10. Color picker: clicking swatch changes color
  it('changes color when a swatch is clicked', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    // Default color is amber (first swatch should be selected)
    const amberSwatch = screen.getByLabelText('Amber');
    const blueSwatch = screen.getByLabelText('Blue');
    expect(amberSwatch.classList.contains('is-selected')).toBe(true);
    expect(blueSwatch.classList.contains('is-selected')).toBe(false);

    // Click blue
    fireEvent.click(blueSwatch);
    expect(blueSwatch.classList.contains('is-selected')).toBe(true);
    expect(amberSwatch.classList.contains('is-selected')).toBe(false);
  });

  it('saves with the selected color', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    fireEvent.click(screen.getByLabelText('Blue'));
    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: 'Colored' },
    });
    fireEvent.click(screen.getByText('Create'));

    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ color: 'blue' }));
  });

  // 11. Escape key closes editor
  it('closes editor when Escape is pressed', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.keyDown(document.querySelector('.note-editor-inner')!, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  // 12. Cmd+Enter saves
  it('saves when Cmd+Enter is pressed', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: 'Shortcut' },
    });
    fireEvent.keyDown(document.querySelector('.note-editor-inner')!, {
      key: 'Enter',
      metaKey: true,
    });

    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shortcut' }));
  });

  it('saves when Ctrl+Enter is pressed', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: 'Ctrl Save' },
    });
    fireEvent.keyDown(document.querySelector('.note-editor-inner')!, {
      key: 'Enter',
      ctrlKey: true,
    });

    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ctrl Save' }));
  });

  // 13. Bullet continuation in textarea
  it('continues bullet list when Enter is pressed after a bullet line', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    const textarea = screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement;
    const bulletText = '- first item';
    fireEvent.change(textarea, { target: { value: bulletText } });

    // Simulate cursor at end of text
    Object.defineProperty(textarea, 'selectionStart', { value: bulletText.length, writable: true });
    Object.defineProperty(textarea, 'selectionEnd', { value: bulletText.length, writable: true });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Content should now have a continuation bullet
    expect((screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement).value).toBe(
      '- first item\n- ',
    );
  });

  it('clears empty bullet when Enter is pressed after "- "', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    const textarea = screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement;
    const bulletText = '- ';
    fireEvent.change(textarea, { target: { value: bulletText } });

    Object.defineProperty(textarea, 'selectionStart', { value: bulletText.length, writable: true });
    Object.defineProperty(textarea, 'selectionEnd', { value: bulletText.length, writable: true });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect((screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement).value).toBe(
      '',
    );
  });

  it('does not continue bullet when Shift+Enter is pressed', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);

    const textarea = screen.getByPlaceholderText('Write something...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '- item' } });

    Object.defineProperty(textarea, 'selectionStart', { value: 6, writable: true });
    Object.defineProperty(textarea, 'selectionEnd', { value: 6, writable: true });

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    // Content should not change (browser handles Shift+Enter normally)
    expect(textarea.value).toBe('- item');
  });

  // Overlay click closes editor
  it('closes when clicking the overlay', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.mouseDown(document.querySelector('.modal-overlay')!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  // Dialog click does not close
  it('does not close when clicking inside the dialog', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    fireEvent.mouseDown(document.querySelector('dialog')!);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  // Dialog aria labels
  it('has aria-label "Edit note" when editing existing note', () => {
    const props = defaultProps();
    props.note = { ...mockNote };
    render(<NoteEditor {...props} />);
    expect(screen.getByLabelText('Edit note')).toBeTruthy();
  });

  it('has aria-label "New note" when creating new note', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    expect(screen.getByLabelText('New note')).toBeTruthy();
  });

  // Reset form when re-opening
  it('resets form when opening with a different note', () => {
    const props = defaultProps();
    props.note = { ...mockNote };

    const { rerender } = render(<NoteEditor {...props} />);

    // Verify initial state
    expect((screen.getByPlaceholderText('Note title...') as HTMLInputElement).value).toBe(
      'Existing Title',
    );

    // Close then reopen with no note
    rerender(<NoteEditor {...props} isOpen={false} />);
    rerender(<NoteEditor {...props} isOpen={true} note={undefined} />);

    expect((screen.getByPlaceholderText('Note title...') as HTMLInputElement).value).toBe('');
  });

  // Keyboard hint
  it('renders keyboard hint with correct modifier key', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} />);
    // The component checks navigator.userAgent for 'Mac'
    const hintText = document.querySelector('.note-editor-hint');
    expect(hintText).toBeTruthy();
    expect(hintText!.textContent).toContain('Save');
  });

  it('does not render the keyboard hint in panel mode', () => {
    const props = defaultProps();
    render(<NoteEditor {...props} variant="panel" />);
    expect(document.querySelector('.note-editor-hint')).toBeNull();
  });
});
