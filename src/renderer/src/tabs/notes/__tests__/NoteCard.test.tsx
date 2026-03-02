import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { NoteCard } from '../NoteCard';
import type { StandaloneNote } from '@shared/ipc';

type MockNoteContentRendererProps = {
  content: string;
  className?: string;
};

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: { role: 'button' },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}));

vi.mock('../NoteContentRenderer', () => ({
  NoteContentRenderer: ({ content, className }: MockNoteContentRendererProps) => (
    <div className={className}>{content}</div>
  ),
}));

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

const mockNote: StandaloneNote = {
  id: 'note-1',
  title: 'Test Note',
  content: 'Some content',
  color: 'amber' as const,
  tags: ['tag1', 'tag2'],
  createdAt: Date.now() - 60000,
  updatedAt: Date.now() - 60000,
};

const defaultProps = () => ({
  note: { ...mockNote, tags: [...mockNote.tags] },
  isDragActive: false,
  isDropTarget: false,
  onClick: vi.fn(),
  onContextMenu: vi.fn(),
});

describe('NoteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // 1. Renders note title, content, tags, "+N" badge, timestamp
  it('renders note title, content, tags and timestamp', () => {
    render(<NoteCard {...defaultProps()} />);
    expect(screen.getByText('Test Note')).toBeTruthy();
    expect(screen.getByText('Some content')).toBeTruthy();
    expect(screen.getByText('tag1')).toBeTruthy();
    expect(screen.getByText('tag2')).toBeTruthy();
    expect(screen.getByText('1m ago')).toBeTruthy();
  });

  it('shows max 3 tags and a "+N" badge for extra tags', () => {
    const props = defaultProps();
    props.note.tags = ['a', 'b', 'c', 'd', 'e'];
    render(<NoteCard {...props} />);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();
    expect(screen.queryByText('d')).toBeNull();
    expect(screen.queryByText('e')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  // 2. onClick calls handler
  it('calls onClick when card is clicked', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Note: Test Note/ }));
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });

  // 3. onContextMenu calls handler
  it('calls onContextMenu on right-click', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /Note: Test Note/ }));
    expect(props.onContextMenu).toHaveBeenCalledTimes(1);
  });

  // 4. Keyboard: Enter calls onClick, Space calls onClick
  it('calls onClick when Enter is pressed', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Note: Test Note/ }), {
      key: 'Enter',
    });
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick when Space is pressed', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Note: Test Note/ }), {
      key: ' ',
    });
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick for other keys', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Note: Test Note/ }), {
      key: 'Tab',
    });
    expect(props.onClick).not.toHaveBeenCalled();
  });

  // 5. Copy button copies text, shows check icon
  it('copies title and content to clipboard on copy button click', async () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    const copyBtn = screen.getByLabelText('Copy note contents');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test Note\n\nSome content');
    // onClick should NOT be called (stopPropagation)
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it('shows check icon after copy and reverts after 1.5s', async () => {
    vi.useFakeTimers();
    const props = defaultProps();
    render(<NoteCard {...props} />);
    const copyBtn = screen.getByLabelText('Copy note contents');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // After copy, the button title changes to "Copied!"
    expect(screen.getByTitle('Copied!')).toBeTruthy();
    // Check icon has a polyline with the checkmark
    expect(copyBtn.querySelector('polyline')).toBeTruthy();

    // Advance timer to revert
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByTitle('Copy')).toBeTruthy();
    expect(copyBtn.querySelector('polyline')).toBeNull();
  });

  it('copies only content when title is empty', async () => {
    const props = defaultProps();
    props.note.title = '';
    render(<NoteCard {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copy note contents'));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Some content');
  });

  // 6. timeAgo function: test all 5 branches
  it('shows "just now" for notes updated less than 1 minute ago', () => {
    const props = defaultProps();
    props.note.updatedAt = Date.now() - 30_000; // 30 seconds
    render(<NoteCard {...props} />);
    expect(screen.getByText('just now')).toBeTruthy();
  });

  it('shows minutes ago for notes updated < 60 minutes ago', () => {
    const props = defaultProps();
    props.note.updatedAt = Date.now() - 25 * 60_000; // 25 minutes
    render(<NoteCard {...props} />);
    expect(screen.getByText('25m ago')).toBeTruthy();
  });

  it('shows hours ago for notes updated < 24 hours ago', () => {
    const props = defaultProps();
    props.note.updatedAt = Date.now() - 5 * 3600_000; // 5 hours
    render(<NoteCard {...props} />);
    expect(screen.getByText('5h ago')).toBeTruthy();
  });

  it('shows days ago for notes updated < 30 days ago', () => {
    const props = defaultProps();
    props.note.updatedAt = Date.now() - 10 * 86_400_000; // 10 days
    render(<NoteCard {...props} />);
    expect(screen.getByText('10d ago')).toBeTruthy();
  });

  it('shows a formatted date for notes updated >= 30 days ago', () => {
    const props = defaultProps();
    props.note.updatedAt = Date.now() - 45 * 86_400_000; // 45 days
    render(<NoteCard {...props} />);
    // The formatted date uses toLocaleDateString with { month: 'short', day: 'numeric' }
    const expected = new Date(props.note.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  // 7. Note without title shows "Untitled"
  it('shows "Untitled" when note has no title', () => {
    const props = defaultProps();
    props.note.title = '';
    render(<NoteCard {...props} />);
    expect(screen.getByText('Untitled')).toBeTruthy();
  });

  it('has aria-label with "Untitled" when note has no title', () => {
    const props = defaultProps();
    props.note.title = '';
    render(<NoteCard {...props} />);
    expect(screen.getByLabelText('Note: Untitled')).toBeTruthy();
  });

  // 8. Note without content does not render NoteContentRenderer
  it('does not render NoteContentRenderer when content is empty', () => {
    const props = defaultProps();
    props.note.content = '';
    render(<NoteCard {...props} />);
    // The mocked NoteContentRenderer renders a div with the content text.
    // With empty content, it should not be rendered at all (conditional rendering).
    const body = document.querySelector('.note-card-body');
    expect(body?.querySelector('.note-card-content')).toBeNull();
  });

  // 9. isDragActive state (source card dimmed via CSS class)
  it('adds dragging class and CSS handles visibility', () => {
    const props = defaultProps();
    props.isDragActive = true;
    render(<NoteCard {...props} />);
    const card = screen.getByRole('button', { name: /Note: Test Note/ });
    expect(card.classList.contains('note-card--dragging')).toBe(true);
  });

  // 10. isDropTarget adds drop target class
  it('adds drop-target class when card is drop target', () => {
    const props = defaultProps();
    props.isDropTarget = true;
    render(<NoteCard {...props} />);
    const card = screen.getByRole('button', { name: /Note: Test Note/ });
    expect(card.classList.contains('note-card--drop-target')).toBe(true);
  });

  // 11. Entire card is the drag surface (attributes applied directly)
  it('renders card as draggable surface', () => {
    const props = defaultProps();
    render(<NoteCard {...props} />);
    const card = screen.getByRole('button', { name: /Note: Test Note/ });
    expect(card).toBeTruthy();
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('applies color class based on note color', () => {
    const props = defaultProps();
    props.note.color = 'blue';
    render(<NoteCard {...props} />);
    const card = screen.getByRole('button', { name: /Note: Test Note/ });
    expect(card.classList.contains('note-card--blue')).toBe(true);
  });

  // No tags: tag section not rendered
  it('does not render tag section when there are no tags', () => {
    const props = defaultProps();
    props.note.tags = [];
    render(<NoteCard {...props} />);
    expect(document.querySelector('.note-card-tags')).toBeNull();
  });
});
