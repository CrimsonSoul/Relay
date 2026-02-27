import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesTab } from '../NotesTab';

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dnd-context">{children}</div>
  ),
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  closestCenter: vi.fn(() => []),
  PointerSensor: vi.fn(),
  useSensors: () => [],
  useSensor: () => ({}),
  useDraggable: () => ({
    attributes: {},
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

// Mock Toast
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Mock ContextMenu
vi.mock('../../components/ContextMenu', () => ({
  ContextMenu: () => null,
}));

// Mock TactileButton
vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// Mock createPortal for the editor modal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...(actual as Record<string, unknown>),
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock SearchContext — default to empty query
let mockDebouncedQuery = '';
vi.mock('../../contexts/SearchContext', () => ({
  useSearchContext: () => ({
    query: mockDebouncedQuery,
    debouncedQuery: mockDebouncedQuery,
    setQuery: vi.fn(),
    isSearchFocused: false,
    setIsSearchFocused: vi.fn(),
    searchInputRef: { current: null },
    focusSearch: vi.fn(),
    clearSearch: vi.fn(),
  }),
}));

describe('NotesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockDebouncedQuery = '';
  });

  it('should show sample notes on first load', () => {
    render(<NotesTab />);
    expect(screen.getByText('Bridge Call Checklist')).toBeInTheDocument();
    expect(screen.getByText('DB Failover Runbook')).toBeInTheDocument();
    expect(screen.getByText('Weekly Ops Review Notes')).toBeInTheDocument();
    expect(screen.getByText('Monitoring Improvements')).toBeInTheDocument();
    expect(screen.getByText('Vendor Contacts')).toBeInTheDocument();
  });

  it('should render the toolbar with font size toggle and new note button', () => {
    render(<NotesTab />);
    expect(screen.getByText('New Note')).toBeInTheDocument();
    expect(screen.getByLabelText('Font size S')).toBeInTheDocument();
    expect(screen.getByLabelText('Font size M')).toBeInTheDocument();
    expect(screen.getByLabelText('Font size L')).toBeInTheDocument();
  });

  it('should render tag pills', () => {
    render(<NotesTab />);
    expect(screen.getByText('All (5)')).toBeInTheDocument();
    // Tags appear in both toolbar pills AND note cards, so check at least one exists
    expect(screen.getAllByText('bridge').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('process').length).toBeGreaterThanOrEqual(1);
  });

  it('should filter notes via global search context', () => {
    mockDebouncedQuery = 'failover';
    render(<NotesTab />);
    expect(screen.getByText('DB Failover Runbook')).toBeInTheDocument();
    expect(screen.queryByText('Bridge Call Checklist')).not.toBeInTheDocument();
  });

  it('should filter notes by tag', () => {
    render(<NotesTab />);
    // Click the "bridge" tag pill in the toolbar (first occurrence)
    fireEvent.click(screen.getAllByText('bridge')[0]);
    expect(screen.getByText('Bridge Call Checklist')).toBeInTheDocument();
    expect(screen.queryByText('DB Failover Runbook')).not.toBeInTheDocument();
  });

  it('should open editor when clicking New Note', () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByText('New Note'));
    expect(screen.getByPlaceholderText('Note title...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write something...')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('should open editor when clicking a note card', () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByText('Bridge Call Checklist'));
    expect(screen.getByDisplayValue('Bridge Call Checklist')).toBeInTheDocument();
    // Editor modal renders Save and Delete buttons (may appear multiple times due to mock)
    const saveButtons = screen.getAllByText('Save');
    const deleteButtons = screen.getAllByText('Delete');
    expect(saveButtons.length).toBeGreaterThanOrEqual(1);
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('should create a new note', () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByText('New Note'));
    const titleInput = screen.getByPlaceholderText('Note title...');
    const contentArea = screen.getByPlaceholderText('Write something...');
    fireEvent.change(titleInput, { target: { value: 'Test Note' } });
    fireEvent.change(contentArea, { target: { value: 'Test content' } });
    fireEvent.click(screen.getByText('Create'));
    expect(screen.getByText('Test Note')).toBeInTheDocument();
  });

  it('should show empty state when search has no results', () => {
    mockDebouncedQuery = 'xyznonexistent';
    render(<NotesTab />);
    expect(screen.getByText('No notes match your search or filter.')).toBeInTheDocument();
  });

  it('should show empty state when no notes exist', () => {
    // Pre-set empty localStorage so no sample notes load
    localStorage.setItem('relay-notepad', '[]');
    render(<NotesTab />);
    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(screen.getByText('Create Note')).toBeInTheDocument();
  });

  it('should display color swatches in the editor', () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByText('New Note'));
    expect(screen.getByLabelText('Amber')).toBeInTheDocument();
    expect(screen.getByLabelText('Blue')).toBeInTheDocument();
    expect(screen.getByLabelText('Green')).toBeInTheDocument();
    expect(screen.getByLabelText('Red')).toBeInTheDocument();
    expect(screen.getByLabelText('Purple')).toBeInTheDocument();
    expect(screen.getByLabelText('Slate')).toBeInTheDocument();
  });

  it('should persist notes to localStorage', () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByText('New Note'));
    fireEvent.change(screen.getByPlaceholderText('Note title...'), {
      target: { value: 'Persisted Note' },
    });
    fireEvent.click(screen.getByText('Create'));

    const stored = JSON.parse(localStorage.getItem('relay-notepad') || '[]');
    expect(stored.some((n: { title: string }) => n.title === 'Persisted Note')).toBe(true);
  });

  it('should set data-font-size attribute on the grid', () => {
    render(<NotesTab />);
    const grid = document.querySelector('.relay-grid--notes');
    expect(grid?.getAttribute('data-font-size')).toBe('md');
  });

  it('should render bullet items in sample notes', () => {
    render(<NotesTab />);
    // DB Failover Runbook uses "- " syntax → rendered as bullet items
    const bullets = document.querySelectorAll('.note-bullet-item');
    expect(bullets.length).toBeGreaterThanOrEqual(1);
  });
});
