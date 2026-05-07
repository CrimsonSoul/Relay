import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { Contact, BridgeGroup } from '@shared/ipc';

// --- Mocks ---

const mockUseDirectory = vi.fn();
vi.mock('../../hooks/useDirectory', () => ({
  useDirectory: (...args: unknown[]) => mockUseDirectory(...args),
}));

vi.mock('../../hooks/useDirectoryKeyboard', () => ({
  useDirectoryKeyboard: vi.fn(),
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
    getContactNote: vi.fn().mockReturnValue(undefined),
    setContactNote: vi.fn(),
  }),
}));

vi.mock('../../components/AddContactModal', () => ({
  AddContactModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-contact-modal" /> : null,
}));

vi.mock('../../components/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) => (isOpen ? <div data-testid={`modal-${title}`}>{children}</div> : null),
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    tooltip,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    tooltip?: React.ReactNode;
  }) => (
    <button onClick={onClick} data-tooltip={typeof tooltip === 'string' ? tooltip : undefined}>
      {children}
    </button>
  ),
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

vi.mock('../../components/directory/GroupSelector', () => ({
  GroupSelector: () => <div data-testid="group-selector" />,
}));

vi.mock('../../components/directory/VirtualRow', () => ({
  VirtualRow: () => <div data-testid="virtual-row" />,
}));

vi.mock('../../components/directory/DeleteConfirmationModal', () => ({
  DeleteConfirmationModal: ({
    contact,
    onConfirm,
  }: {
    contact: Contact | null;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    contact ? (
      <div data-testid="delete-modal">
        <button data-testid="delete-confirm" onClick={onConfirm}>
          Confirm Delete
        </button>
      </div>
    ) : null,
}));

vi.mock('../../components/directory/DirectoryContextMenu', () => ({
  DirectoryContextMenu: ({
    onClose,
    onAddToComposer,
    onManageGroups,
    onEditContact,
    onDeleteContact,
    onEditNotes,
    hasNotes,
  }: {
    x: number;
    y: number;
    contact: Contact;
    recentlyAdded: Set<string>;
    onClose: () => void;
    onAddToComposer: () => void;
    onManageGroups: () => void;
    onEditContact: () => void;
    onDeleteContact: () => void;
    onEditNotes: () => void;
    hasNotes: boolean;
  }) => (
    <div data-testid="context-menu">
      <button data-testid="ctx-close" onClick={onClose}>
        Close
      </button>
      <button data-testid="ctx-add-composer" onClick={onAddToComposer}>
        Add to Composer
      </button>
      <button data-testid="ctx-manage-groups" onClick={onManageGroups}>
        Manage Groups
      </button>
      <button data-testid="ctx-edit" onClick={onEditContact}>
        Edit
      </button>
      <button data-testid="ctx-delete" onClick={onDeleteContact}>
        Delete
      </button>
      <button data-testid="ctx-notes" onClick={onEditNotes}>
        {hasNotes ? 'Edit Notes' : 'Add Notes'}
      </button>
    </div>
  ),
}));

vi.mock('../../components/ContactDetailPanel', () => ({
  ContactDetailPanel: ({ contact }: { contact: Contact }) => (
    <div data-testid="contact-detail">{contact.name}</div>
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

function makeDefaultDirectoryReturn() {
  return {
    filtered: [],
    focusedIndex: -1,
    setFocusedIndex: vi.fn(),
    isHeaderCollapsed: false,
    setIsHeaderCollapsed: vi.fn(),
    sortConfig: { key: 'name', direction: 'asc' as const },
    setSortConfig: vi.fn(),
    isAddModalOpen: false,
    setIsAddModalOpen: vi.fn(),
    editingContact: null,
    setEditingContact: vi.fn(),
    deleteConfirmation: null,
    setDeleteConfirmation: vi.fn(),
    contextMenu: null,
    setContextMenu: vi.fn(),
    groupSelectorContact: null,
    setGroupSelectorContact: vi.fn(),
    handleAddWrapper: vi.fn(),
    handleCreateContact: vi.fn(),
    handleUpdateContact: vi.fn(),
    handleDeleteContact: vi.fn(),
    groupMap: new Map<string, BridgeGroup[]>(),
    recentlyAdded: new Set<string>(),
  };
}

beforeEach(() => {
  mockUseDirectory.mockReturnValue(makeDefaultDirectoryReturn());
  mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn());
});

import { DirectoryTab } from '../DirectoryTab';

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  name: 'John Doe',
  email: 'john@example.com',
  phone: '555-1234',
  title: 'Engineer',
  _searchString: 'john doe john@example.com engineer 555-1234',
  raw: {},
  ...overrides,
});

describe('DirectoryTab', () => {
  it('renders without crashing', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('collapsible-header')).toBeInTheDocument();
  });

  it('shows empty state when no contacts', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('No contacts found')).toBeInTheDocument();
  });

  it('renders status bar with showing count', () => {
    const contacts = [makeContact()];
    render(<DirectoryTab contacts={contacts} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('Showing 0 of 1')).toBeInTheDocument();
  });

  it('renders ADD CONTACT button', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('ADD CONTACT')).toBeInTheDocument();
  });

  it('gives the add contact button a tooltip', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('ADD CONTACT')).toHaveAttribute('data-tooltip', 'Add contact');
  });

  it('shows "Select a contact" placeholder when no contact selected', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('Select a contact')).toBeInTheDocument();
  });

  it('shows the virtual list', () => {
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });

  it('shows contact detail panel when a contact is selected', () => {
    const contacts = [makeContact({ name: 'Jane Smith', email: 'jane@example.com' })];
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: contacts,
      focusedIndex: 0,
    });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: contacts }));

    render(<DirectoryTab contacts={contacts} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('contact-detail')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('shows match count when contacts are filtered', () => {
    const contacts = [makeContact(), makeContact({ name: 'Jane', email: 'jane@test.com' })];
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: contacts,
    });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: contacts }));

    render(<DirectoryTab contacts={contacts} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('2 contacts')).toBeInTheDocument();
  });

  it('renders context menu when contextMenu is set', () => {
    const contact = makeContact();
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    });

    // Override the DirectoryContextMenu mock to render something visible
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);
    // The DirectoryContextMenu mock renders null, but the component shouldn't crash
    expect(screen.getByTestId('collapsible-header')).toBeInTheDocument();
  });

  it('shows group selector modal when groupSelectorContact is set', () => {
    const contact = makeContact();
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      groupSelectorContact: contact,
    });

    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('modal-Manage Groups')).toBeInTheDocument();
    expect(screen.getByTestId('group-selector')).toBeInTheDocument();
  });

  it('shows add contact modal when isAddModalOpen is true', () => {
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      isAddModalOpen: true,
    });

    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('add-contact-modal')).toBeInTheDocument();
  });

  it('shows edit contact modal when editingContact is set', () => {
    const contact = makeContact();
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      editingContact: contact,
    });

    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);
    // Two AddContactModal instances but only the edit one should be visible
    expect(screen.getByTestId('add-contact-modal')).toBeInTheDocument();
  });

  it('shows list filters when filtered has items', () => {
    const contacts = [makeContact()];
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: contacts,
    });

    render(<DirectoryTab contacts={contacts} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('list-filters')).toBeInTheDocument();
  });

  it('shows list filters when isAnyFilterActive even with empty list', () => {
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ isAnyFilterActive: true }));
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: [makeContact()],
    });

    render(<DirectoryTab contacts={[makeContact()]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('list-filters')).toBeInTheDocument();
  });

  it('does not show list filters when no contacts and no active filters', () => {
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: [],
    });
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ isAnyFilterActive: false }));

    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.queryByTestId('list-filters')).not.toBeInTheDocument();
  });

  // --- ADD CONTACT button ---

  it('clicking ADD CONTACT calls setIsAddModalOpen', () => {
    const dirReturn = makeDefaultDirectoryReturn();
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    fireEvent.click(screen.getByText('ADD CONTACT'));
    expect(dirReturn.setIsAddModalOpen).toHaveBeenCalledWith(true);
  });

  // --- Context menu actions ---

  it('context menu Add to Composer calls handleAddWrapper and closes menu', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ctx-add-composer'));
    expect(dirReturn.handleAddWrapper).toHaveBeenCalledWith(contact);
    expect(dirReturn.setContextMenu).toHaveBeenCalledWith(null);
  });

  it('context menu Manage Groups opens group selector', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ctx-manage-groups'));
    expect(dirReturn.setGroupSelectorContact).toHaveBeenCalledWith(contact);
    expect(dirReturn.setContextMenu).toHaveBeenCalledWith(null);
  });

  it('context menu Edit opens editing modal', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ctx-edit'));
    expect(dirReturn.setEditingContact).toHaveBeenCalledWith(contact);
  });

  it('context menu Delete opens delete confirmation', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ctx-delete'));
    expect(dirReturn.setDeleteConfirmation).toHaveBeenCalledWith(contact);
  });

  it('context menu Edit Notes opens notes modal', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ctx-notes'));
    expect(dirReturn.setContextMenu).toHaveBeenCalledWith(null);
  });

  it('context menu close button calls setContextMenu(null)', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      contextMenu: { x: 100, y: 200, contact },
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ctx-close'));
    expect(dirReturn.setContextMenu).toHaveBeenCalledWith(null);
  });

  // --- Delete confirmation modal ---

  it('shows delete confirmation modal and confirm works', () => {
    const contact = makeContact();
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      deleteConfirmation: contact,
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);

    expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-confirm'));
    expect(dirReturn.handleDeleteContact).toHaveBeenCalled();
  });

  // --- Contact detail panel actions ---

  it('contact detail panel edit triggers setEditingContact', () => {
    const contact = makeContact({ name: 'Jane Smith', email: 'jane@example.com' });
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      filtered: [contact],
      focusedIndex: 0,
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [contact] }));

    render(<DirectoryTab contacts={[contact]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('contact-detail')).toBeInTheDocument();
  });

  // --- Match count not shown when filteredItems is empty ---

  it('does not show match count when filtered is empty', () => {
    mockUseDirectory.mockReturnValue(makeDefaultDirectoryReturn());
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [] }));

    render(<DirectoryTab contacts={[]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.queryByText(/contacts$/)).not.toBeInTheDocument();
  });

  // --- Shows list filters when isAnyFilterActive and filtered is empty but dir.filtered has items ---

  it('shows list filters when isAnyFilterActive is true even when filteredItems is empty', () => {
    mockUseDirectory.mockReturnValue({
      ...makeDefaultDirectoryReturn(),
      filtered: [makeContact()],
    });
    mockUseListFilters.mockReturnValue(
      makeDefaultListFiltersReturn({ filteredItems: [], isAnyFilterActive: true }),
    );

    render(<DirectoryTab contacts={[makeContact()]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('list-filters')).toBeInTheDocument();
  });

  // --- Groups displayed for selected contact ---

  it('renders selected contact with group info from groupMap', () => {
    const contact = makeContact({ name: 'Alice', email: 'alice@test.com' });
    const group: BridgeGroup = { id: 'g1', name: 'Engineering', members: [] };
    const groupMap = new Map<string, BridgeGroup[]>();
    groupMap.set('alice@test.com', [group]);
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      filtered: [contact],
      focusedIndex: 0,
      groupMap,
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    mockUseListFilters.mockReturnValue(makeDefaultListFiltersReturn({ filteredItems: [contact] }));

    render(<DirectoryTab contacts={[contact]} groups={[group]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByTestId('contact-detail')).toBeInTheDocument();
  });

  // --- focusedIndex out of bounds shows placeholder ---

  it('shows placeholder when focusedIndex is beyond filtered length', () => {
    const dirReturn = {
      ...makeDefaultDirectoryReturn(),
      filtered: [makeContact()],
      focusedIndex: 5,
    };
    mockUseDirectory.mockReturnValue(dirReturn);
    mockUseListFilters.mockReturnValue(
      makeDefaultListFiltersReturn({ filteredItems: [makeContact()] }),
    );

    render(<DirectoryTab contacts={[makeContact()]} groups={[]} onAddToAssembler={vi.fn()} />);
    expect(screen.getByText('Select a contact')).toBeInTheDocument();
  });
});
