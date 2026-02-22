import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesModal } from '../NotesModal';

// Mock useFocusTrap
vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

// Mock sub-components
vi.mock('../notes/TagBadge', () => ({
  TagBadge: ({ tag, onRemove }: { tag: string; onRemove: (t: string) => void }) =>
    React.createElement(
      'span',
      { 'data-testid': `tag-${tag}` },
      tag,
      React.createElement(
        'button',
        { onClick: () => onRemove(tag), 'aria-label': `remove-${tag}` },
        'x',
      ),
    ),
}));

vi.mock('../notes/TagInput', () => ({
  TagInput: ({
    value,
    onChange,
    _onAdd,
    onKeyDown,
    id,
  }: {
    value: string;
    onChange: (v: string) => void;
    onAdd: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    id: string;
  }) =>
    React.createElement('input', {
      id,
      'data-testid': 'tag-input',
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      onKeyDown,
    }),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  entityType: 'contact' as const,
  entityId: 'alice@example.com',
  entityName: 'Alice Smith',
  onSave: vi.fn().mockResolvedValue(true),
};

describe('NotesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('renders nothing when closed', () => {
    render(<NotesModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Contact Notes')).not.toBeInTheDocument();
  });

  it('renders the modal when open', () => {
    render(<NotesModal {...defaultProps} />);
    expect(screen.getByText('Contact Notes')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('shows "Server Notes" for server entityType', () => {
    render(<NotesModal {...defaultProps} entityType="server" entityName="Alpha Bridge" />);
    expect(screen.getByText('Server Notes')).toBeInTheDocument();
  });

  it('pre-fills note from existingNote', () => {
    render(
      <NotesModal
        {...defaultProps}
        existingNote={{ note: 'Prior note text', tags: ['urgent'], updatedAt: 0 }}
      />,
    );
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Prior note text');
  });

  it('pre-fills tags from existingNote', () => {
    render(
      <NotesModal
        {...defaultProps}
        existingNote={{ note: '', tags: ['alpha', 'beta'], updatedAt: 0 }}
      />,
    );
    expect(screen.getByTestId('tag-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('tag-beta')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close modal backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('updates note textarea on change', () => {
    render(<NotesModal {...defaultProps} />);
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New note content' } });
    expect(textarea.value).toBe('New note content');
  });

  it('removes a tag when remove button is clicked', () => {
    render(
      <NotesModal {...defaultProps} existingNote={{ note: '', tags: ['alpha'], updatedAt: 0 }} />,
    );
    expect(screen.getByTestId('tag-alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('remove-alpha'));
    expect(screen.queryByTestId('tag-alpha')).not.toBeInTheDocument();
  });

  it('calls onSave with trimmed note and tags on Save', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onSave={onSave} onClose={onClose} />);

    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  Hello World  ' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Notes'));
    });

    expect(onSave).toHaveBeenCalledWith('Hello World', []);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not call onClose if onSave returns falsy', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    render(<NotesModal {...defaultProps} onSave={onSave} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Save Notes'));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows "Saving..." while save is in progress', async () => {
    let resolveSave!: (v: boolean) => void;
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<NotesModal {...defaultProps} onSave={onSave} />);

    act(() => {
      fireEvent.click(screen.getByText('Save Notes'));
    });

    await waitFor(() => expect(screen.getByText('Saving...')).toBeInTheDocument());

    await act(async () => {
      resolveSave(true);
    });
  });
});
