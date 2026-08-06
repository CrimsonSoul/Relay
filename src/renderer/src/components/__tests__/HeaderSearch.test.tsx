import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { BridgeAPI, Contact, Server } from '@shared/ipc';
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
} from '@shared/knowledgeSearch';
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

const mockSearchResults: Array<{
  id: string;
  title: string;
  subtitle?: string;
  type: string;
  data: unknown;
  iconType?: string;
}> = [];
vi.mock('../../hooks/useCommandSearch', () => ({
  useCommandSearch: () => mockSearchResults,
}));

const { mockUseKnowledgeLibrary } = vi.hoisted(() => ({
  mockUseKnowledgeLibrary: vi.fn(() => ({ documents: [] })),
}));
vi.mock('../../features/knowledge/useKnowledgeLibrary', () => ({
  useKnowledgeLibrary: mockUseKnowledgeLibrary,
}));

const { mockKnowledgeBoundaryError } = vi.hoisted(() => ({
  mockKnowledgeBoundaryError: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  loggers: { ui: { error: mockKnowledgeBoundaryError } },
}));

let mockKnowledgeIconFailure = false;
vi.mock('../command-palette/CommandIcons', () => ({
  ContactIcon: ({ name }: { name: string }) => <span data-testid="contact-icon">{name}</span>,
  GroupIcon: () => <span data-testid="group-icon" />,
  ServerIcon: () => <span data-testid="server-icon" />,
  KnowledgeIcon: () => {
    if (mockKnowledgeIconFailure) throw new TypeError('passage render failure');
    return <span data-testid="knowledge-icon" />;
  },
  ActionIcon: ({ type }: { type: string }) => <span data-testid="action-icon">{type}</span>,
}));

const defaultActions: HeaderSearchActions = {
  onAddContactToBridge: vi.fn(),
  onToggleGroup: vi.fn(),
  onNavigateToTab: vi.fn(),
  onOpenKnowledgeDestination: vi.fn(),
  onOpenKnowledgeRecord: vi.fn(),
  onOpenAddContact: vi.fn(),
  onOpenKnowledgeDocument: vi.fn(),
};

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  name: 'John Doe',
  email: 'john@test.com',
  phone: '',
  title: '',
  _searchString: 'john doe john@test.com',
  raw: {},
  ...overrides,
});

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'web-server',
  businessArea: '',
  lob: '',
  comment: '',
  owner: '',
  contact: '',
  os: '',
  _searchString: 'web-server',
  raw: {},
  ...overrides,
});

const defaultProps = {
  activeTab: 'Compose',
  contacts: [],
  servers: [],
  groups: [],
  actions: defaultActions,
};

const makePassageResult = (
  overrides: Partial<KnowledgeSearchResult> = {},
): KnowledgeSearchResult => ({
  id: 'passage-1',
  documentId: 'kb-2',
  checksum: 'b'.repeat(64),
  title: 'Oracle SOP Manual',
  fileName: 'Oracle SOP Manual.pdf',
  category: 'Database',
  categoryId: 'database',
  documentType: 'sop',
  headingId: 'failover',
  heading: 'Failover procedure',
  pageIndex: 3,
  passageNumber: 1,
  excerpt: 'Use the standby listener before promoting the database.',
  matchKind: 'fuzzy',
  highlightText: 'failover',
  normalizedStart: 48,
  normalizedEnd: 56,
  score: 0.91,
  ...overrides,
});

const successResponse = (
  request: KnowledgeSearchRequest,
  results: KnowledgeSearchResult[],
): KnowledgeSearchResponse => ({
  ok: true,
  requestId: request.requestId,
  availability: 'ready',
  normalizedQuery: request.query,
  results,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const settlePassageSearch = async () => {
  await act(async () => vi.advanceTimersByTimeAsync(200));
};

// Stub scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn();

/**
 * `globalThis.api` is typed as the complete desktop bridge, but HeaderSearch only
 * reaches for these members. Holding the mocks in file scope keeps every assertion
 * pointed at the same function instances the component was handed, and
 * `Partial<BridgeAPI>` still type-checks each stub against the real contract.
 */
let searchKnowledge: MockedFunction<BridgeAPI['searchKnowledge']>;
let cancelKnowledgeSearch: MockedFunction<BridgeAPI['cancelKnowledgeSearch']>;

describe('HeaderSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchContext.query = '';
    mockSearchContext.isSearchFocused = false;
    mockSearchContext.searchInputRef = { current: null };
    mockSearchResults.length = 0;
    mockKnowledgeIconFailure = false;
    mockUseKnowledgeLibrary.mockClear();
    searchKnowledge = vi.fn<BridgeAPI['searchKnowledge']>();
    cancelKnowledgeSearch = vi.fn<BridgeAPI['cancelKnowledgeSearch']>();
    const bridge: Partial<BridgeAPI> = {
      platform: 'darwin',
      searchKnowledge,
      cancelKnowledgeSearch,
    };
    vi.stubGlobal('api', bridge);
  });

  it('renders the search input', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search Relay...')).toBeInTheDocument();
  });

  it('defers the Wiki library while global search is idle outside Knowledge', () => {
    render(<HeaderSearch {...defaultProps} />);

    expect(mockUseKnowledgeLibrary).toHaveBeenCalledWith({ enabled: false });
  });

  it('enables the Wiki library while search is focused or Knowledge is active', () => {
    mockSearchContext.isSearchFocused = true;
    const { unmount } = render(<HeaderSearch {...defaultProps} />);
    expect(mockUseKnowledgeLibrary).toHaveBeenCalledWith({ enabled: true });
    unmount();

    mockUseKnowledgeLibrary.mockClear();
    mockSearchContext.isSearchFocused = false;
    render(<HeaderSearch {...defaultProps} activeTab="Knowledge" />);
    expect(mockUseKnowledgeLibrary).toHaveBeenCalledWith({ enabled: true });
  });

  it('renders the search input with correct aria-label', () => {
    render(<HeaderSearch {...defaultProps} />);
    expect(screen.getByLabelText('Search Relay')).toBeInTheDocument();
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
    const lastCall = calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBe(true);
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

  it('renders with Knowledge active tab', () => {
    render(<HeaderSearch {...defaultProps} activeTab="Knowledge" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  describe('with dropdown results', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'test';
      mockSearchResults.push(
        {
          id: 'c1',
          title: 'John Doe',
          subtitle: 'john@test.com',
          type: 'contact',
          data: makeContact({ raw: { id: 'contact_1' } }),
        },
        { id: 'g1', title: 'Engineering', type: 'group', data: { id: 'grp-1' } },
        {
          id: 's1',
          title: 'web-server',
          type: 'server',
          data: makeServer({ raw: { id: 'server_1' } }),
        },
        {
          id: 'a1',
          title: 'Go to Servers',
          type: 'action',
          data: { action: 'navigate', tab: 'Servers' },
          iconType: 'navigate',
        },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows dropdown when focused with results', () => {
      render(<HeaderSearch {...defaultProps} />);
      // Advance past the 200ms debounce
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      // On Compose tab, 'server' type is filtered, so 3 items remain
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('keeps the fixed dropdown anchored to the input on scroll and resize', () => {
      const rectAt = (top: number): DOMRect =>
        ({
          top,
          bottom: top + 32,
          left: 24,
          right: 424,
          width: 400,
          height: 32,
          x: 24,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      const rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue(rectAt(40));

      try {
        render(<HeaderSearch {...defaultProps} />);
        act(() => {
          vi.advanceTimersByTime(250);
        });

        const dropdown = document.querySelector('.search-dropdown') as HTMLElement;
        expect(dropdown.style.position).toBe('fixed');
        expect(dropdown.style.top).toBe('80px');

        // Fixed coordinates go stale the instant the header moves.
        rectSpy.mockReturnValue(rectAt(0));
        fireEvent.scroll(document);
        expect(dropdown.style.top).toBe('40px');

        rectSpy.mockReturnValue(rectAt(96));
        fireEvent(window, new Event('resize'));
        expect(dropdown.style.top).toBe('136px');
      } finally {
        rectSpy.mockRestore();
      }
    });

    it('allows the dropdown to widen to 540px when viewport space permits', () => {
      const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 40,
        bottom: 76,
        left: 24,
        right: 724,
        width: 700,
        height: 36,
        x: 24,
        y: 40,
        toJSON: () => ({}),
      } as DOMRect);
      const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);

      try {
        render(<HeaderSearch {...defaultProps} />);
        act(() => {
          vi.advanceTimersByTime(250);
        });

        expect(document.querySelector<HTMLElement>('.search-dropdown')?.style.width).toBe('540px');
      } finally {
        rectSpy.mockRestore();
        widthSpy.mockRestore();
      }
    });

    it('shows result titles in dropdown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      // On Compose tab, 'server' type is filtered out, so 3 items remain
      expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });

    it('shows result subtitles when present', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('john@test.com')).toBeInTheDocument();
    });

    it('renders concise primary verbs in a stable action rail', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      const options = screen.getAllByRole('option');
      for (const option of options) {
        expect(option.querySelector('.search-dropdown-action-rail')).not.toBeNull();
      }
      expect(options[0]).toHaveTextContent('Open');
      expect(options[1]).toHaveTextContent('Add group');
      expect(options[2]).toHaveTextContent('Select');
      expect(options[0]!.querySelector('.search-dropdown-result-verb')).toHaveTextContent('Open');
      expect(options[1]!.querySelector('.search-dropdown-result-verb')).toHaveTextContent(
        'Add group',
      );
    });

    it('keeps the contact bridge action separate from the full-row primary target', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      const contactOption = screen.getAllByRole('option')[0]!;
      const primaryAction = contactOption.querySelector('.search-dropdown-hitbox');
      const bridgeAction = screen.getByRole('button', { name: 'Add John Doe to bridge' });

      expect(contactOption.querySelector('.search-dropdown-result-row')).toHaveClass(
        'has-secondary-action',
      );
      expect(contactOption.querySelector('.search-dropdown-result-icon')).not.toBeNull();
      expect(contactOption.querySelector('.search-dropdown-result-info')).not.toBeNull();
      expect(contactOption.querySelector('.search-dropdown-action-rail')).not.toBeNull();
      expect(bridgeAction).toHaveTextContent('+ Bridge');
      expect(primaryAction?.contains(bridgeAction)).toBe(false);
      expect(contactOption.querySelectorAll('button')).toHaveLength(2);

      const groupOption = screen.getAllByRole('option')[1]!;
      expect(groupOption.querySelectorAll('.search-dropdown-secondary-action')).toHaveLength(0);
    });

    it('renders icons for each visible result type', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      // On Compose tab, 'server' is filtered out
      expect(screen.getByTestId('contact-icon')).toBeInTheDocument();
      expect(screen.getByTestId('group-icon')).toBeInTheDocument();
      expect(screen.getByTestId('action-icon')).toBeInTheDocument();
    });

    it('navigates down with ArrowDown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Second item should now be selected (aria-selected)
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates up with ArrowUp', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('opens a contact on Enter without mutating Compose or clearing lookup context', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
        destination: 'contacts',
        recordKey: 'id:contact_1',
      });
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
      expect(mockSearchContext.clearSearch).not.toHaveBeenCalled();
    });

    it('opens a contact from a keyboard-generated primary button click', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      const primaryAction = document.querySelector('.search-dropdown-hitbox');
      expect(primaryAction).toBeInstanceOf(HTMLButtonElement);
      fireEvent.click(primaryAction as HTMLButtonElement, { detail: 0 });

      expect(defaultActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
        destination: 'contacts',
        recordKey: 'id:contact_1',
      });
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
    });

    it('selects group on Enter after ArrowDown and calls onToggleGroup', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onToggleGroup).toHaveBeenCalledWith('grp-1');
    });

    it('selects action on Enter and calls onNavigateToTab for navigate action', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      // On Compose tab, results are: contact(0), group(1), action(2) — server is filtered
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onNavigateToTab).toHaveBeenCalledWith('Servers');
    });

    it('adds a contact from a keyboard-generated secondary button click', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add John Doe to bridge' }), {
        detail: 0,
      });
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('john@test.com');
      expect(defaultActions.onOpenKnowledgeRecord).not.toHaveBeenCalled();
      expect(mockSearchContext.clearSearch).toHaveBeenCalledOnce();
    });

    it('bridges the active contact on Tab instead of following normal focus traversal', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      const input = screen.getByRole('combobox');
      const dispatched = fireEvent.keyDown(input, { key: 'Tab', cancelable: true });

      expect(dispatched).toBe(false);
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('john@test.com');
      expect(defaultActions.onOpenKnowledgeRecord).not.toHaveBeenCalled();
      expect(mockSearchContext.clearSearch).toHaveBeenCalledOnce();
    });

    it('updates selectedIndex on mouseEnter', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const hitboxes = document.querySelectorAll('.search-dropdown-hitbox');
      expect(hitboxes[1]).toBeDefined();
      fireEvent.mouseEnter(hitboxes[1]!);
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('does not treat the outer Knowledge workspace as a filtered list', () => {
      render(<HeaderSearch {...defaultProps} activeTab="Knowledge" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getAllByRole('option')).toHaveLength(4);
      expect(screen.queryByText(/Filtering Knowledge list/)).not.toBeInTheDocument();
    });

    it('ranks results from the active Knowledge destination first', () => {
      render(<HeaderSearch {...defaultProps} activeTab="Knowledge" preferredResultType="server" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.getAllByRole('option')[0]).toHaveTextContent('web-server');
    });

    it('caps immediate results at 15 after preferred-result ranking', () => {
      mockSearchResults.splice(
        0,
        mockSearchResults.length,
        ...Array.from({ length: 16 }, (_, index) => ({
          id: `contact-${index}`,
          title: `Contact ${index}`,
          type: 'contact',
          data: { email: `contact${index}@example.com` },
        })),
        {
          id: 'server-preferred',
          title: 'Preferred server',
          type: 'server',
          data: { name: 'Preferred server' },
        },
      );

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" preferredResultType="server" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.getAllByRole('option')).toHaveLength(15);
      expect(screen.getAllByRole('option')[0]).toHaveTextContent('Preferred server');
      expect(screen.queryByText('Contact 15')).not.toBeInTheDocument();
    });

    it('shows keyboard shortcut hints in dropdown footer', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Navigate')).toBeInTheDocument();
      expect(screen.getByText('Primary action')).toBeInTheDocument();
      expect(screen.getByText('Bridge contact')).toBeInTheDocument();
      expect(screen.getByText('Close')).toBeInTheDocument();
    });

    it('advertises the bridge shortcut only while a contact result is active', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      const input = screen.getByRole('combobox');
      expect(screen.getByText('Bridge contact')).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.queryByText('Bridge contact')).not.toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(screen.getByText('Bridge contact')).toBeInTheDocument();
    });

    it('does not advertise a secondary keyboard action without contact results', () => {
      mockSearchResults.splice(0, mockSearchResults.length, {
        id: 'g1',
        title: 'Engineering',
        type: 'group',
        data: { id: 'grp-1' },
      });

      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.queryByText('Bridge contact')).not.toBeInTheDocument();
    });

    it('has aria-expanded true when dropdown is shown', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
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
      mockSearchResults.push({
        id: 'a1',
        title: 'Create Contact',
        type: 'action',
        data: { action: 'create-contact', value: 'new@test.com' },
        iconType: 'create',
      });
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Create')).toBeVisible();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onOpenAddContact).toHaveBeenCalledWith('new@test.com');
    });

    it('handles add-manual action', () => {
      mockSearchResults.push({
        id: 'a2',
        title: 'Add Manual',
        type: 'action',
        data: { action: 'add-manual', value: 'manual@test.com' },
        iconType: 'add',
      });
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Add')).toBeVisible();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onAddContactToBridge).toHaveBeenCalledWith('manual@test.com');
    });

    it('handles add-manual action without value (no-op)', () => {
      mockSearchResults.push({
        id: 'a3',
        title: 'Add Manual No Value',
        type: 'action',
        data: { action: 'add-manual' },
        iconType: 'add',
      });
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      // add-manual without value does not call onAddContactToBridge
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
    });

    it('handles an explicit Contacts workspace action', () => {
      mockSearchResults.push({
        id: 'action-contacts',
        title: 'Go to Contacts',
        type: 'action',
        data: { action: 'open-knowledge', destination: 'contacts' },
        iconType: 'people',
      });
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

      expect(defaultActions.onOpenKnowledgeDestination).toHaveBeenCalledWith('contacts');
    });

    it('handles action with unknown action type (no-op)', () => {
      mockSearchResults.push({
        id: 'a4',
        title: 'Unknown Action',
        type: 'action',
        data: { action: 'unknown-action' },
        iconType: 'add',
      });
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
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
        {
          id: 'c1',
          title: 'John Doe',
          subtitle: 'john@test.com',
          type: 'contact',
          data: { email: 'john@test.com' },
        },
        { id: 'g1', title: 'Engineering', type: 'group', data: { id: 'grp-1' } },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clamps ArrowDown at the last index', () => {
      // On Compose tab, only contact and group are shown (2 items)
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const input = screen.getByRole('combobox');
      // Press down 5 times — should clamp at index 1 (last)
      for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('clamps ArrowUp at index 0', () => {
      render(<HeaderSearch {...defaultProps} />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
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
      mockSearchResults.push({
        id: 's1',
        title: 'web-server',
        type: 'server',
        data: makeServer({ raw: { id: 'server_1' } }),
      });
      // 'Alerts' is not in FILTERABLE_TABS, so no types are hidden
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(screen.getByText('Open')).toBeVisible();
      expect(defaultActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
        destination: 'servers',
        recordKey: 'id:server_1',
      });
      expect(mockSearchContext.clearSearch).not.toHaveBeenCalled();
    });

    it('renders server icon for server results on non-filterable tab', () => {
      mockSearchResults.push({
        id: 's1',
        title: 'web-server',
        type: 'server',
        data: { name: 'web-server' },
      });
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByTestId('server-icon')).toBeInTheDocument();
    });

    it('does not filter results on non-filterable tab', () => {
      mockSearchResults.push(
        { id: 'c1', title: 'John', type: 'contact', data: { email: 'j@t.com' } },
        { id: 's1', title: 'web-server', type: 'server', data: { name: 'web-server' } },
        { id: 'g1', title: 'Eng', type: 'group', data: { id: 'grp-1' } },
      );
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
  });

  describe('knowledge result selection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'recovery';
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens the selected knowledge document and renders its distinct icon', () => {
      mockSearchResults.push({
        id: 'knowledge-kb-1',
        title: 'Lane recovery',
        type: 'knowledge',
        data: {
          document: { id: 'kb-1' },
          headingId: 'restart-service',
        },
      });
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.getByTestId('knowledge-icon')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(defaultActions.onOpenKnowledgeDocument).toHaveBeenCalledWith({
        documentId: 'kb-1',
        headingId: 'restart-service',
      });
    });
  });

  describe('Wiki passage results', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearchContext.isSearchFocused = true;
      mockSearchContext.query = 'oracle';
      mockSearchResults.push({
        id: 'knowledge-kb-1',
        title: 'Oracle Database Server',
        subtitle: 'Infrastructure',
        type: 'knowledge',
        data: { document: { id: 'kb-1', outline: [] } },
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts universal passage search after one 150ms debounce', async () => {
      searchKnowledge.mockReturnValue(deferred<KnowledgeSearchResponse>().promise);

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await act(async () => vi.advanceTimersByTimeAsync(149));
      expect(searchKnowledge).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(searchKnowledge).toHaveBeenCalledTimes(1);
      expect(searchKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'oracle', scope: { kind: 'all' }, limit: 20 }),
      );
    });

    it('shows immediate results while passage search is still pending', async () => {
      const pending = deferred<KnowledgeSearchResponse>();
      searchKnowledge.mockReturnValue(pending.promise);

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();

      expect(screen.getByText('Oracle Database Server')).toBeVisible();
      expect(screen.queryByText('Wiki passages')).not.toBeInTheDocument();
      expect(searchKnowledge).toHaveBeenCalledTimes(1);
      expect(searchKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'oracle', scope: { kind: 'all' }, limit: 20 }),
      );
    });

    it('keeps immediate results when Wiki passage search rejects', async () => {
      searchKnowledge.mockRejectedValue(new Error('offline'));

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();

      expect(screen.getByText('Oracle Database Server')).toBeVisible();
      expect(screen.queryByText('Wiki passages')).not.toBeInTheDocument();
    });

    it('renders one presentation heading and keeps option indices contiguous', async () => {
      const passages = [
        makePassageResult(),
        makePassageResult({
          id: 'passage-2',
          documentId: 'kb-3',
          title: 'Oracle Recovery Checklist',
          headingId: null,
          heading: null,
          pageIndex: 1,
          matchKind: 'exact',
        }),
      ];
      searchKnowledge.mockImplementation((request) =>
        Promise.resolve(successResponse(request, passages)),
      );

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();

      const group = screen.getByText('Wiki passages');
      expect(group).toHaveAttribute('role', 'presentation');
      expect(screen.getAllByText('Wiki passages')).toHaveLength(1);
      expect(screen.getAllByRole('option')).toHaveLength(3);
      expect(document.querySelectorAll('[data-index]')).toHaveLength(3);
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-activedescendant',
        'search-result-0',
      );
      expect(screen.getByText('Page 4')).toBeInTheDocument();
      expect(screen.getAllByText('Database')).toHaveLength(2);
      expect(screen.getByText('Failover procedure')).toBeInTheDocument();
      expect(screen.getByText('Close match')).toBeInTheDocument();
    });

    it('opens an async passage with its complete canonical target by keyboard and mouse', async () => {
      const passage = makePassageResult();
      searchKnowledge.mockImplementation((request) =>
        Promise.resolve(successResponse(request, [passage])),
      );

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-1');
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultActions.onOpenKnowledgeDocument).toHaveBeenLastCalledWith({
        documentId: passage.documentId,
        headingId: passage.headingId,
        pageIndex: passage.pageIndex,
        highlightText: passage.highlightText,
        normalizedStart: passage.normalizedStart,
        normalizedEnd: passage.normalizedEnd,
      });

      vi.mocked(defaultActions.onOpenKnowledgeDocument).mockClear();
      fireEvent.click(screen.getByText('Failover procedure').closest('button')!);
      expect(defaultActions.onOpenKnowledgeDocument).toHaveBeenCalledWith({
        documentId: passage.documentId,
        headingId: passage.headingId,
        pageIndex: passage.pageIndex,
        highlightText: passage.highlightText,
        normalizedStart: passage.normalizedStart,
        normalizedEnd: passage.normalizedEnd,
      });

      mockSearchContext.clearSearch.mockClear();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(mockSearchContext.clearSearch).toHaveBeenCalledTimes(1);
    });

    it('deduplicates only the same document, page, and heading destination', async () => {
      mockSearchResults.splice(0, 1, {
        id: 'knowledge-kb-2',
        title: 'Oracle SOP Manual',
        subtitle: 'Database · Failover procedure',
        type: 'knowledge',
        data: {
          document: {
            id: 'kb-2',
            outline: [{ id: 'failover', label: 'Failover procedure', pageIndex: 3 }],
          },
          headingId: 'failover',
        },
      });
      const duplicate = makePassageResult();
      const distinctPage = makePassageResult({ id: 'passage-2', pageIndex: 4 });
      const duplicatePassage = makePassageResult({ id: 'passage-3', pageIndex: 4 });
      searchKnowledge.mockImplementation((request) =>
        Promise.resolve(successResponse(request, [duplicate, distinctPage, duplicatePassage])),
      );

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();

      expect(screen.getAllByRole('option')).toHaveLength(2);
      expect(screen.getByText('Page 5')).toBeInTheDocument();
      expect(screen.queryByText('Page 4')).not.toBeInTheDocument();
    });

    it('does not publish a stale passage completion after the query changes', async () => {
      const oldSearch = deferred<KnowledgeSearchResponse>();
      searchKnowledge.mockImplementation((request) => {
        if (request.query === 'oracle') return oldSearch.promise;
        return Promise.resolve(
          successResponse(request, [
            makePassageResult({
              id: 'network-passage',
              title: 'Network recovery',
              heading: 'Network failover',
            }),
          ]),
        );
      });

      const view = render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();
      mockSearchContext.query = 'network';
      view.rerender(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();
      expect(screen.getByText('Network recovery')).toBeInTheDocument();

      const firstCall = searchKnowledge.mock.calls[0];
      expect(firstCall).toBeDefined();
      const oldRequest = firstCall![0];
      await act(async () => oldSearch.resolve(successResponse(oldRequest, [makePassageResult()])));

      expect(screen.queryByText('Oracle SOP Manual')).not.toBeInTheDocument();
      expect(screen.getByText('Network recovery')).toBeInTheDocument();
    });

    it('removes boundary-failed passages from keyboard and ARIA navigation', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockSearchResults.splice(0, 1, {
        id: 'contact-operator',
        title: 'Oracle operator',
        subtitle: 'operator@example.com',
        type: 'contact',
        data: { email: 'operator@example.com' },
      });
      mockKnowledgeIconFailure = true;
      searchKnowledge.mockImplementation((request) =>
        Promise.resolve(successResponse(request, [makePassageResult()])),
      );

      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      await settlePassageSearch();

      expect(screen.getAllByText('Oracle operator')).toHaveLength(2);
      expect(screen.queryByText('Wiki passages')).not.toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(1);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(defaultActions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
        destination: 'contacts',
        recordKey: 'email:operator@example.com',
      });
      expect(defaultActions.onAddContactToBridge).not.toHaveBeenCalled();
      expect(defaultActions.onOpenKnowledgeDocument).not.toHaveBeenCalled();
      expect(mockKnowledgeBoundaryError).toHaveBeenCalledWith(
        'Enhanced Wiki search rendering failed',
        { errorClass: 'TypeError' },
      );
      consoleError.mockRestore();
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
      mockSearchResults.push({ id: 'u1', title: 'Unknown', type: 'unknown' as string, data: {} });
      render(<HeaderSearch {...defaultProps} activeTab="Alerts" />);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      // The result should render but the icon area should be empty
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});
