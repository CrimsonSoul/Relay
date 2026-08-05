import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { Server, Contact } from '@shared/ipc';

/**
 * Reads one element out of a `getAllBy*` result, failing loudly rather than
 * handing `undefined` to a DOM helper when the query matched fewer elements.
 */
const elementAt = (elements: HTMLElement[], index: number, label: string): HTMLElement => {
  const element = elements.at(index);
  if (!element) {
    throw new Error(`Expected a ${label} at index ${index}, but only found ${elements.length}`);
  }
  return element;
};

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

const mockSetServerNote = vi.fn();

vi.mock('../../contexts', () => ({
  useNotesContext: () => ({
    getServerNote: vi.fn().mockReturnValue(undefined),
    setServerNote: mockSetServerNote,
  }),
}));

vi.mock('../../components/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: Array<{ label: string; onClick: () => void }> }) => (
    <div data-testid="context-menu">
      {items.map((item) => (
        <button key={item.label} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
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
  ServerCard: ({
    server,
    recordKey,
    selected,
    onRowClick,
  }: {
    server: Server;
    recordKey: string;
    selected: boolean;
    onRowClick: () => void;
  }) => (
    <button
      type="button"
      aria-label={server.name}
      data-testid="server-card"
      data-record-key={recordKey}
      data-selected={selected}
      onClick={onRowClick}
    >
      {server.name}
    </button>
  ),
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

vi.mock('../../components/ListToolbar', () => ({
  ListToolbar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="list-toolbar">{children}</div>
  ),
}));

vi.mock('../../components/ListFilters', () => ({
  ListFilters: () => <div data-testid="list-filters" />,
}));

vi.mock('../../components/ServerDetailPanel', () => ({
  ServerDetailPanel: ({
    server,
    onDelete,
    onEditNotes,
  }: {
    server: Server;
    onDelete: () => void;
    onEditNotes: () => void;
  }) => (
    <div data-testid="server-detail" data-record-id={server.raw?.id}>
      {server.name}
      <button type="button" data-testid="server-detail-delete" onClick={onDelete} />
      <button type="button" data-testid="server-detail-notes" onClick={onEditNotes} />
    </div>
  ),
}));

// The real NotesModal closes itself on any truthy onSave result, so the stub records exactly what
// the tab resolves rather than re-implementing that decision.
const noteSaveOutcomes: unknown[] = [];

vi.mock('../../components/NotesModal', () => ({
  NotesModal: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (note: string, tags: string[]) => Promise<boolean | undefined>;
  }) =>
    isOpen ? (
      <div data-testid="notes-modal">
        <button
          type="button"
          data-testid="notes-modal-save"
          onClick={() => void onSave('Patched overnight', []).then((r) => noteSaveOutcomes.push(r))}
        />
      </div>
    ) : null,
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

const { mockScrollToRow, mockListRef } = vi.hoisted(() => {
  const scrollToRow = vi.fn();
  return { mockScrollToRow: scrollToRow, mockListRef: { current: { scrollToRow } } };
});

// Mock react-window — rows are rendered so row selection can be exercised
vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowHeight,
    rowComponent: RowComponent,
    rowProps,
  }: {
    rowCount: number;
    rowHeight: number;
    rowComponent: React.ComponentType<Record<string, unknown>>;
    rowProps: Record<string, unknown>;
  }) => (
    <div data-testid="virtual-list" data-row-count={rowCount} data-row-height={rowHeight}>
      {Array.from({ length: rowCount }, (_unused, index) => (
        <RowComponent key={index} index={index} style={{}} {...rowProps} />
      ))}
    </div>
  ),
  useListRef: () => mockListRef,
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
  noteSaveOutcomes.length = 0;
  mockSetServerNote.mockReset();
  mockScrollToRow.mockReset();
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
  it.each([
    ['renders without crashing', 'collapsible-header'],
    ['shows virtual list', 'virtual-list'],
  ])('%s', (_caseName, expectedTestId) => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
  });

  it.each([
    ['shows empty state when no servers', 'No infrastructure found'],
    ['shows "Select a server" placeholder when no server selected', 'Select a server'],
    ['renders ADD SERVER button', 'ADD SERVER'],
  ])('%s', (_caseName, expectedText) => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  it('provides an independent local server filter', () => {
    render(<ServersTab servers={[]} contacts={[]} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter servers' }), {
      target: { value: 'payments' },
    });

    expect(mockUseServers).toHaveBeenLastCalledWith([], [], 'payments');
  });

  it('renders status bar with showing count', () => {
    const servers = [makeServer()];
    render(<ServersTab servers={servers} contacts={[]} />);
    expect(screen.getByText('Showing 0 of 1')).toBeInTheDocument();
  });

  it('uses the approved compact record height', () => {
    render(<ServersTab servers={[]} contacts={[]} />);
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-row-height', '67');
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
    expect(screen.getByTestId('server-detail')).toHaveTextContent('db-server-01');
  });

  it('reports a deleted requested server without selecting another record', async () => {
    const different = makeServer({ name: 'Different Server', raw: { id: 'server_1' } });
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      filteredServers: [different],
    });
    mockUseListFilters.mockReturnValue(
      makeDefaultListFiltersReturn({ filteredItems: [different] }),
    );
    const onSelectionUnavailable = vi.fn();

    render(
      <ServersTab
        servers={[different]}
        contacts={[]}
        selectionRequest={{
          requestId: 8,
          destination: 'servers',
          recordKey: 'id:deleted',
        }}
        onSelectionUnavailable={onSelectionUnavailable}
      />,
    );

    await waitFor(() => expect(onSelectionUnavailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('server-detail')).not.toBeInTheDocument();
    expect(screen.getByText('Select a server')).toBeVisible();
  });

  it('keeps the requested server exact when another record shares its name', async () => {
    const first = makeServer({ name: 'shared-server', raw: { id: 'server_1' } });
    const second = makeServer({ name: 'shared-server', raw: { id: 'server_2' } });
    mockUseListFilters.mockReturnValue(
      makeDefaultListFiltersReturn({ filteredItems: [first, second] }),
    );

    render(
      <ServersTab
        servers={[first, second]}
        contacts={[]}
        selectionRequest={{
          requestId: 10,
          destination: 'servers',
          recordKey: 'id:server_2',
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('server-detail')).toHaveAttribute('data-record-id', 'server_2'),
    );
  });

  it('keeps the detail panel on the selected server when filtering reorders the list', () => {
    const web = makeServer({ name: 'web-server-01' });
    const db = makeServer({ name: 'db-server-01' });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [web, db] }));

    const { rerender } = render(<ServersTab servers={[web, db]} contacts={[]} />);
    fireEvent.click(elementAt(screen.getAllByTestId('server-card'), 1, 'server card'));
    expect(screen.getByTestId('server-detail')).toHaveTextContent('db-server-01');

    // A filter that drops db-server-01 must clear the panel, not silently rebind it to
    // whatever record now sits at index 1 — the Delete button points at this record.
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [web] }));
    rerender(<ServersTab servers={[web, db]} contacts={[]} />);

    expect(screen.queryByTestId('server-detail')).not.toBeInTheDocument();
    expect(screen.getByText('Select a server')).toBeInTheDocument();
  });

  it('follows the selected server when filtering only changes its position', () => {
    const web = makeServer({ name: 'web-server-01' });
    const db = makeServer({ name: 'db-server-01' });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [web, db] }));

    const { rerender } = render(<ServersTab servers={[web, db]} contacts={[]} />);
    fireEvent.click(elementAt(screen.getAllByTestId('server-card'), 1, 'server card'));

    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [db, web] }));
    rerender(<ServersTab servers={[web, db]} contacts={[]} />);

    expect(screen.getByTestId('server-detail')).toHaveTextContent('db-server-01');
    expect(screen.getAllByTestId('server-card')[0]).toHaveAttribute('data-selected', 'true');
  });

  it('confirms before deleting from the detail panel', () => {
    const servers = [makeServer({ name: 'db-server-01' })];
    const deleteServer = vi.fn().mockResolvedValue(undefined);
    mockUseServers.mockReturnValue({ ...makeDefaultServersReturn(), deleteServer });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: servers }));

    render(<ServersTab servers={servers} contacts={[]} />);
    fireEvent.click(screen.getByTestId('server-detail-delete'));

    expect(deleteServer).not.toHaveBeenCalled();
    expect(
      screen.getByText('Delete db-server-01? This action cannot be undone.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteServer).toHaveBeenCalledWith(servers[0]);
  });

  it('confirms before deleting from the right-click menu', () => {
    const server = makeServer({ name: 'db-server-01' });
    const deleteServer = vi.fn().mockResolvedValue(undefined);
    const setContextMenu = vi.fn();
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      contextMenu: { x: 10, y: 20, server },
      setContextMenu,
      deleteServer,
    });

    render(<ServersTab servers={[server]} contacts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Server' }));

    expect(deleteServer).not.toHaveBeenCalled();
    expect(setContextMenu).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteServer).toHaveBeenCalledWith(server);
  });

  it('surfaces a failed delete instead of closing the confirmation', async () => {
    const servers = [makeServer({ name: 'db-server-01' })];
    const deleteServer = vi.fn().mockRejectedValue(new Error('Server record is locked'));
    mockUseServers.mockReturnValue({ ...makeDefaultServersReturn(), deleteServer });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: servers }));

    render(<ServersTab servers={servers} contacts={[]} />);
    fireEvent.click(screen.getByTestId('server-detail-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server record is locked');
  });

  // Regression: setServerNote resolves an IpcResult, and the tab handed that object straight back
  // to NotesModal, which only checks truthiness. A failed save therefore closed the modal as if it
  // had worked and the operator's note was gone.
  it.each([
    ['a rejected save', { success: false, error: 'offline' }, false],
    ['an accepted save', { success: true }, true],
  ])('reports %s to the notes modal as a boolean', async (_caseName, ipcResult, expected) => {
    const servers = [makeServer({ name: 'db-server-01' })];
    mockSetServerNote.mockResolvedValue(ipcResult);
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: servers }));

    render(<ServersTab servers={servers} contacts={[]} />);
    fireEvent.click(screen.getByTestId('server-detail-notes'));
    fireEvent.click(screen.getByTestId('notes-modal-save'));

    await waitFor(() => expect(noteSaveOutcomes).toHaveLength(1));
    expect(mockSetServerNote).toHaveBeenCalledWith('db-server-01', 'Patched overnight', []);
    expect(noteSaveOutcomes[0]).toBe(expected);
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

  it('configures a compact set of useful server quick filters', () => {
    const linuxServer = makeServer({
      os: 'Ubuntu 22.04',
      comment: 'Requires quarterly patch review',
    });
    const windowsServer = makeServer({
      name: 'win-server-01',
      os: 'Windows',
      owner: '',
      contact: '',
    });
    const macServer = makeServer({ name: 'mac-mini-01', os: 'macOS' });
    const servers = [linuxServer, windowsServer, macServer];
    mockUseServers.mockReturnValue({
      ...makeDefaultServersReturn(),
      filteredServers: servers,
    });

    render(<ServersTab servers={servers} contacts={[]} />);

    const options = mockUseListFilters.mock.calls.at(-1)?.[0];
    const labels = options.extraFilters.map((filter: { label: string }) => filter.label);
    expect(labels).toEqual(['Missing Owner', 'Missing Support', 'Has Comment', 'Linux', 'Windows']);
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
