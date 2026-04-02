import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { Server, Contact } from '@shared/ipc';

// --- Mocks ---

const mockUseServers = vi.fn();
vi.mock('../../hooks/useServers', () => ({
  useServers: (...args: unknown[]) => mockUseServers(...args),
}));

const mockUseListFilters = vi.fn();
vi.mock('../../hooks/useListFilters', () => ({
  useListFilters: (...args: unknown[]) => mockUseListFilters(...args),
}));

function makeDefaultListFiltersReturn(overrides: Record<string, unknown> = {}) {
  return {
    filteredItems: [],
    hasNotesFilter: false,
    selectedTags: new Set<string>(),
    availableTags: [],
    activeExtras: new Set<string>(),
    extraFilters: [],
    isAnyFilterActive: false,
    toggleHasNotes: vi.fn(),
    toggleTag: vi.fn(),
    toggleExtra: vi.fn(),
    clearAll: vi.fn(),
    ...overrides,
  };
}

vi.mock('../../contexts', () => ({
  useNotesContext: () => ({
    getServerNote: vi.fn().mockReturnValue(undefined),
    setServerNote: vi.fn(),
  }),
}));

vi.mock('../../components/ContextMenu', () => ({
  ContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock('../../components/AddServerModal', () => ({
  AddServerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-server-modal" /> : null,
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('../../components/ServerCard', () => ({
  ServerCard: () => <div data-testid="server-card" />,
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

vi.mock('../../components/ListToolbar', () => ({
  ListToolbar: () => <div data-testid="list-toolbar" />,
}));

vi.mock('../../components/ListFilters', () => ({
  ListFilters: () => <div data-testid="list-filters" />,
}));

vi.mock('../../components/ServerDetailPanel', () => ({
  ServerDetailPanel: ({ server }: { server: Server }) => (
    <div data-testid="server-detail">{server.name}</div>
  ),
}));

vi.mock('../../components/NotesModal', () => ({
  NotesModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="notes-modal" /> : null,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="status-bar">{right}</div>
  ),
  StatusBarLive: () => <span data-testid="status-bar-live" />,
}));

// Mock react-virtualized-auto-sizer
vi.mock('react-virtualized-auto-sizer', () => ({
  AutoSizer: ({
    renderProp,
  }: {
    renderProp: (size: { height: number; width: number }) => React.ReactNode;
  }) => renderProp({ height: 600, width: 800 }),
}));

// Mock react-window
vi.mock('react-window', () => ({
  List: ({ rowCount }: { rowCount: number }) => (
    <div data-testid="virtual-list" data-row-count={rowCount} />
  ),
  useListRef: () => ({ current: null }),
}));

function makeDefaultServersReturn() {
  return {
    filteredServers: [],
    isHeaderCollapsed: false,
    setIsHeaderCollapsed: vi.fn(),
    sortOrder: 'asc' as const,
    setSortOrder: vi.fn(),
    sortKey: 'name' as const,
    setSortKey: vi.fn(),
    contextMenu: null,
    setContextMenu: vi.fn(),
    handleContextMenu: vi.fn(),
    handleEdit: vi.fn(),
    handleDelete: vi.fn(),
    isAddModalOpen: false,
    setIsAddModalOpen: vi.fn(),
    openAddModal: vi.fn(),
    editingServer: null,
    editServer: vi.fn(),
    deleteServer: vi.fn(),
    contactLookup: new Map<string, Contact>(),
  };
}

beforeEach(() => {
  mockUseServers.mockReturnValue(makeDefaultServersReturn());
  mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn());
});

import { ServersTab } from '../ServersTab';

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'web-server-01',
  businessArea: 'Engineering',
  lob: 'Platform',
  comment: '',
  owner: 'owner@example.com',
  contact: 'contact@example.com',
  os: 'Linux',
  _searchString: 'web-server-01 engineering platform linux',
  raw: {},
  ...overrides,
});

describe('ServersTab', () => {
  it('renders without crashing', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId('collapsible-header')).toBeInTheDocument();
  });

  it('shows empty state when no servers', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByText('No infrastructure found')).toBeInTheDocument();
  });

  it('shows "Select a server" placeholder when no server selected', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByText('Select a server')).toBeInTheDocument();
  });

  it('renders ADD SERVER button', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByText('ADD SERVER')).toBeInTheDocument();
  });

  it('renders status bar with showing count', () => {
    const servers = [makeServer()];
    render(<ServersTab servers={servers} contacts={[]} />);
    expect(screen.getByText('Showing 0 of 1')).toBeInTheDocument();
  });

  it('shows virtual list', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });

  it('does not show add server modal by default', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.queryByTestId('add-server-modal')).not.toBeInTheDocument();
  });

  it('renders the list toolbar', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId('list-toolbar')).toBeInTheDocument();
  });

  it('shows server detail panel when useListFilters returns items and selection is valid', () => {
    const servers = [makeServer({ name: 'db-server-01' })];
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: servers }));

    render(<ServersTab servers={servers} contacts={[]} />);
    expect(screen.getByTestId('server-detail')).toBeInTheDocument();
    expect(screen.getByText('db-server-01')).toBeInTheDocument();
  });

  it('renders context menu when contextMenu is present', () => {
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      contextMenu: { x: 100, y: 200, server: makeServer() },
    });
    render(<ServersTab servers={[makeServer()]} contacts={[]} />);
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('shows add server modal when isAddModalOpen is true', () => {
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      isAddModalOpen: true,
    });
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId('add-server-modal')).toBeInTheDocument();
  });

  it('shows match count when displayedServers has items', () => {
    const servers = [makeServer()];
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: servers }));

    render(<ServersTab servers={servers} contacts={[]} />);
    expect(screen.getByText('1 servers')).toBeInTheDocument();
  });

  it('shows list filters when filteredServers has items', () => {
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      filteredServers: [makeServer()],
    });
    render(<ServersTab servers={[makeServer()]} contacts={[]} />);
    expect(screen.getByTestId('list-filters')).toBeInTheDocument();
  });

  it('shows list filters when isAnyFilterActive', () => {
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ isAnyFilterActive: true }));
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      filteredServers: [makeServer()],
    });

    render(<ServersTab servers={[makeServer()]} contacts={[]} />);
    expect(screen.getByTestId('list-filters')).toBeInTheDocument();
  });

  it('does not show list filters when no filteredServers and no active filters', () => {
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      filteredServers: [],
    });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ isAnyFilterActive: false }));

    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.queryByTestId('list-filters')).not.toBeInTheDocument();
  });
});
