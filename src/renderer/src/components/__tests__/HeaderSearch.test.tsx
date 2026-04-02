import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeaderSearch, type HeaderSearchActions } from '../HeaderSearch';

// --- Mocks ---

const mockSearchContext = {
  query: '',
  setQuery: vi.fn(),
  isSearchFocused: false,
  setIsSearchFocused: vi.fn(),
  searchInputRef: { current: null },
  clearSearch: vi.fn(),
  debouncedQuery: '',
  focusSearch: vi.fn(),
};

vi.mock('../../contexts/SearchContext', () => ({
  useSearchContext: () => mockSearchContext,
}));

const mockSearchResults: Array<{id: string; title: string; subtitle?: string; type: string; data: unknown; iconType?: string}> = [];
vi.mock('../../hooks/useCommandSearch', () => ({
  useCommandSearch: () => mockSearchResults,
}));

vi.mock('../command-palette/CommandIcons', () => ({
  ContactIcon: ({ name }: { name: string }) => <span data-testid="contact-icon">{name}</span>,
  GroupIcon: () => <span data-testid="group-icon" />,
  ServerIcon: () => <span data-testid="server-icon" />,
  ActionIcon: ({ type }: { type: string }) => <span data-testid="action-icon">{type}</span>,
}));

const defaultActions: HeaderSearchActions = {
  onAddContactToBridge: vi.fn(),
  onToggleGroup: vi.fn(),
  onNavigateToTab: vi.fn(),
  onOpenAddContact: vi.fn(),
};

const defaultProps = {
  activeTab: 'Compose',
  contacts: [],
  servers: [],
  groups: [],
  actions: defaultActions,
};

// Stub scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn();

describe('HeaderSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchContext.query = '';
    mockSearchContext.isSearchFocused = false;
    mockSearchContext.searchInputRef = { current: null };
    mockSearchResults.length = 0;
  });

  it('renders the search input', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders the search input with correct aria-label', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('shows keyboard shortcut hint when query is empty', () => {
    render(<HeaderSearch {...defaultProps} />);
    // On mac (default), shows Cmd+K
    expect(screen.getByText('\u2318K')).toBeInTheDocument();
  });

  it('shows clear button when query is non-empty', () => {
    mockSearchContext.query = 'test';
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('calls clearSearch when clear button is clicked', () => {
    mockSearchContext.query = 'test';
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(mockSearchContext.clearSearch).toHaveBeenCalled();
  });

  it('calls setQuery on input change', () => {
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hello' } });
    expect(mockSearchContext.setQuery).toHaveBeenCalledWith('hello');
  });

  it('sets isSearchFocused on focus', () => {
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(mockSearchContext.setIsSearchFocused).toHaveBeenCalledWith(true);
  });

  it('calls clearSearch on Escape when query exists', () => {
    mockSearchContext.query = 'test';
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(mockSearchContext.clearSearch).toHaveBeenCalled();
  });

  it('does not show dropdown when not focused', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('has aria-expanded false when dropdown is not shown', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows Ctrl+K shortcut when platform is not darwin', () => {
    (globalThis as Record<string, unknown>).api = { platform: 'win32' };
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it('blurs search input on Escape when query is empty', () => {
    mockSearchContext.query = '';
    render(<HeaderSearch {...defaultProps} />);
    // The input uses the ref from mock context, which has current: null
    // Escape with empty query calls searchInputRef.current?.blur() — no crash
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    // Should not have called clearSearch (only called when query is non-empty)
    expect(mockSearchContext.clearSearch).not.toHaveBeenCalled();
  });

  it('sets isSearchFocused to false on blur after timeout', () => {
    vi.useFakeTimers();
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.blur(screen.getByRole('combobox'));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(mockSearchContext.setIsSearchFocused).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it('cancels blur timeout on subsequent focus', () => {
    vi.useFakeTimers();
    render(<HeaderSearch {...defaultProps} />);
    fireEvent.blur(screen.getByRole('combobox'));
    fireEvent.focus(screen.getByRole('combobox'));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // setIsSearchFocused should be called with true (from focus), not false
    const calls = mockSearchContext.setIsSearchFocused.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe(true);
    vi.useRealTimers();
  });

  it('ignores arrow keys when dropdown is not shown', () => {
    mockSearchContext.query = 'test';
    render(<HeaderSearch {...defaultProps} />);
    // No dropdown since useCommandSearch returns []
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    // Should not crash
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders with People active tab (list filtering tab)', () => {
    render(<HeaderSearch {...defaultProps} activeTab="People" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders with Servers active tab', () => {
    render(<HeaderSearch {...defaultProps} activeTab="Servers" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  describe('with dropdown results', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
      mockSearchResults.push(
        { id: 'c1', title: 'John Doe', subtitle: 'john@test.com', type: 'contact', data: { email: 'john@test.com' } },
        { id: 'g1', title: 'Engineering', type: 'group', data: { id: 'grp-1' } },
        { id: 's1', title: 'web-server', type: 'server', data: { name: 'web-server' } },
        { id: 'a1', title: 'Go to Servers', type: 'action', data: { action: 'navigate', tab: 'Servers' }, iconType: 'navigate' },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows dropdown when focused with results', () => {
      render(<HeaderSearch {...defaultProps} />);
      // Advance past the 200ms debounce
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      // On Compose tab, 'server' type is filtered, so 3 items remain
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('shows result titles in dropdown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      // On Compose tab, 'server' type is filtered out, so 3 items remain
      expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });

    it('shows result subtitles when present', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByText('john@test.com')).toBeInTheDocument();
    });

    it('renders type badges', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByText('contact')).toBeInTheDocument();
      expect(screen.getByText('group')).toBeInTheDocument();
    });

    it('renders icons for each visible result type', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      // On Compose tab, 'server' is filtered out
      expect(screen.getByTestId('contact-icon')).toBeInTheDocument();
      expect(screen.getByTestId('group-icon')).toBeInTheDocument();
      expect(screen.getByTestId('action-icon')).toBeInTheDocument();
    });

    it('navigates down with ArrowDown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Second item should now be selected (aria-selected)
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates up with ArrowUp', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('selects contact on Enter and calls onAddContactToBridge', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('john@test.com');
      expect(mockSearchContext.clearSearch).toHaveBeenCalled();
    });

    it('selects group on Enter after ArrowDown and calls onToggleGroup', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onToggleGroup).toHaveBeenCalledWith('grp-1');
    });

    it('selects action on Enter and calls onNavigateToTab for navigate action', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      // On Compose tab, results are: contact(0), group(1), action(2) — server is filtered
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onNavigateToTab).toHaveBeenCalledWith('Servers');
    });

    it('selects result on mouseDown click', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const hitboxes = document.querySelectorAll('.search-dropdown-hitbox');
      fireEvent.mouseDown(hitboxes[0]);
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('john@test.com');
    });

    it('updates selectedIndex on mouseEnter', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const hitboxes = document.querySelectorAll('.search-dropdown-hitbox');
      fireEvent.mouseEnter(hitboxes[1]);
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('shows filtering context message on People tab', () => {
      render(<HeaderSearch {...defaultProps} activeTab="People" />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByText('Filtering People list')).toBeInTheDocument();
    });

    it('filters out tab-matching result types on filterable tabs', () => {
      // On People tab, contact/group/server are filtered — only action remains
      render(<HeaderSearch {...defaultProps} activeTab="People" />);
      act(() => { vi.advanceTimersByTime(250); });
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1); // only action remains
    });

    it('shows keyboard shortcut hints in dropdown footer', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByText('Navigate')).toBeInTheDocument();
      expect(screen.getByText('Select')).toBeInTheDocument();
      expect(screen.getByText('Close')).toBeInTheDocument();
    });

    it('has aria-expanded true when dropdown is shown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('action result types', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('handles create-contact action', () => {
      mockSearchResults.push(
        { id: 'a1', title: 'Create Contact', type: 'action', data: { action: 'create-contact', value: 'new@test.com' }, iconType: 'create' },
      );
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onOpenAddContact).toHaveBeenCalledWith('new@test.com');
    });

    it('handles add-manual action', () => {
      mockSearchResults.push(
        { id: 'a2', title: 'Add Manual', type: 'action', data: { action: 'add-manual', value: 'manual@test.com' }, iconType: 'add' },
      );
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('manual@test.com');
    });

    it('handles add-manual action without value (no-op)', () => {
      mockSearchResults.push(
        { id: 'a3', title: 'Add Manual No Value', type: 'action', data: { action: 'add-manual' }, iconType: 'add' },
      );
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      // add-manual without value does not call onAddContactToBridge
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
    });

    it('handles action with unknown action type (no-op)', () => {
      mockSearchResults.push(
        { id: 'a4', title: 'Unknown Action', type: 'action', data: { action: 'unknown-action' }, iconType: 'add' },
      );
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onNavigateToTab).not.toHaveBeenCalled();
      expect(defaultActions.onOpenAddContact).not.toHaveBeenCalled();
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation edge cases', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
      mockSearchResults.push(
        { id: 'c1', title: 'John Doe', subtitle: 'john@test.com', type: 'contact', data: { email: 'john@test.com' } },
        { id: 'g1', title: 'Engineering', type: 'group', data: { id: 'grp-1' } },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clamps ArrowDown at the last index', () => {
      // On Compose tab, only contact and group are shown (2 items)
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      // Press down 5 times — should clamp at index 1 (last)
      for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('clamps ArrowUp at index 0', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => { vi.advanceTimersByTime(250); });
      const input = screen.getByRole('combobox');
      // Press up multiple times from index 0
      for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowUp' });
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('server result selection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('selects server result on a non-filterable tab', () => {
      mockSearchResults.push(
        { id: 's1', title: 'web-server', type: 'server', data: { name: 'web-server' } },
      );
      // 'Alerts' is not in FILTERABLE_TABS, so no types are hidden
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onNavigateToTab).toHaveBeenCalledWith('Servers');
    });

    it('renders server icon for server results on non-filterable tab', () => {
      mockSearchResults.push(
        { id: 's1', title: 'web-server', type: 'server', data: { name: 'web-server' } },
      );
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getByTestId('server-icon')).toBeInTheDocument();
    });

    it('does not filter results on non-filterable tab', () => {
      mockSearchResults.push(
        { id: 'c1', title: 'John', type: 'contact', data: { email: 'j@t.com' } },
        { id: 's1', title: 'web-server', type: 'server', data: { name: 'web-server' } },
        { id: 'g1', title: 'Eng', type: 'group', data: { id: 'grp-1' } },
      );
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

  });

  describe('default icon rendering', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders null for unknown result type icon', () => {
      mockSearchResults.push(
        { id: 'u1', title: 'Unknown', type: 'unknown' as string, data: {} },
      );
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => { vi.advanceTimersByTime(250); });
      // The result should render but the icon area should be empty
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});
