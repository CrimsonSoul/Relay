import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssemblerTab } from '../AssemblerTab';
import type { BridgeGroup, Contact, BridgeHistoryEntry } from '@shared/ipc';

// ── mock sub-components ─────────────────────────────────────────────────────
vi.mock('../assembler', () => ({
  AssemblerSidebar: () => <div data-testid="assembler-sidebar" />,
  BridgeReminderModal: ({
    isOpen,
    onClose,
    onConfirm,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div data-testid="bridge-reminder-modal">
        <button onClick={onClose}>close-reminder</button>
        <button onClick={onConfirm}>confirm-reminder</button>
      </div>
    ) : null,
  SaveGroupModal: ({
    isOpen,
    onClose,
    onSave,
    title,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (name: string) => void;
    title: string;
  }) =>
    isOpen ? (
      <div data-testid="save-group-modal">
        <span>{title}</span>
        <button onClick={onClose}>close-save</button>
        <button onClick={() => onSave('TestGroup')}>save-group</button>
      </div>
    ) : null,
  BridgeHistoryModal: ({
    isOpen,
    onClose,
    onLoad,
    onSaveAsGroup,
  }: {
    isOpen: boolean;
    onClose: () => void;
    history: BridgeHistoryEntry[];
    onLoad: (e: BridgeHistoryEntry) => void;
    onDelete: (id: string) => void;
    onClear: () => void;
    onSaveAsGroup: (e: BridgeHistoryEntry) => void;
  }) =>
    isOpen ? (
      <div data-testid="bridge-history-modal">
        <button onClick={onClose}>close-history</button>
        <button
          onClick={() =>
            onLoad({
              id: 'h1',
              note: '',
              groups: ['Alpha'],
              contacts: ['a@example.com'],
              recipientCount: 1,
              createdAt: Date.now(),
            })
          }
        >
          load-history
        </button>
        <button
          onClick={() =>
            onSaveAsGroup({
              id: 'h1',
              note: '',
              groups: [],
              contacts: ['x@example.com'],
              recipientCount: 1,
              createdAt: Date.now(),
            })
          }
        >
          save-as-group
        </button>
      </div>
    ) : null,
  CompositionList: () => <div data-testid="composition-list" />,
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

vi.mock('../../components/ListToolbar', () => ({
  ListToolbar: () => <div data-testid="list-toolbar" />,
}));

vi.mock('../../components/AddContactModal', () => ({
  AddContactModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="add-contact-modal">
        <button onClick={onClose}>close-add-contact</button>
      </div>
    ) : null,
}));

vi.mock('../../components/ContextMenu', () => ({
  ContextMenu: ({
    items,
    onClose,
  }: {
    x: number;
    y: number;
    onClose: () => void;
    items: { label: string; onClick: () => void }[];
  }) => (
    <div data-testid="context-menu">
      {items.map((item) => (
        <button key={item.label} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
      <button onClick={onClose}>close-ctx</button>
    </div>
  ),
}));

vi.mock('../../components/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    children,
    title,
  }: {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title: string;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <span>{title}</span>
        <button onClick={onClose}>close-modal</button>
        {children}
      </div>
    ) : null,
}));

vi.mock('../../components/directory/GroupSelector', () => ({
  GroupSelector: () => <div data-testid="group-selector" />,
}));

// ── mock hooks ───────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockSaveGroup = vi.fn().mockResolvedValue({ id: 'g-new', name: 'TestGroup', contacts: [] });
const mockUpdateGroup = vi.fn().mockResolvedValue(true);
const mockDeleteGroup = vi.fn().mockResolvedValue(true);
const mockImportFromCsv = vi.fn().mockResolvedValue(true);
vi.mock('../../hooks/useGroups', () => ({
  useGroups: () => ({
    saveGroup: mockSaveGroup,
    updateGroup: mockUpdateGroup,
    deleteGroup: mockDeleteGroup,
    importFromCsv: mockImportFromCsv,
  }),
}));

const mockAddHistory = vi.fn().mockResolvedValue(undefined);
const mockDeleteHistory = vi.fn();
const mockClearHistory = vi.fn();
vi.mock('../../hooks/useBridgeHistory', () => ({
  useBridgeHistory: () => ({
    history: [],
    addHistory: mockAddHistory,
    deleteHistory: mockDeleteHistory,
    clearHistory: mockClearHistory,
  }),
}));

// useAssembler returns a rich object — we mock selected fields
const mockSetIsBridgeReminderOpen = vi.fn();
const mockSetIsAddContactModalOpen = vi.fn();
const mockSetCompositionContextMenu = vi.fn();
const mockSetIsHeaderCollapsed = vi.fn();
const mockSetSearch = vi.fn();
const mockSetSortConfig = vi.fn();
const mockHandleCopy = vi.fn().mockResolvedValue(undefined);
const mockExecuteDraftBridge = vi.fn();
const mockHandleAddToContacts = vi.fn();

const baseAsm = {
  sortConfig: { key: 'name', direction: 'asc' },
  setSortConfig: mockSetSortConfig,
  isBridgeReminderOpen: false,
  setIsBridgeReminderOpen: mockSetIsBridgeReminderOpen,
  isAddContactModalOpen: false,
  setIsAddContactModalOpen: mockSetIsAddContactModalOpen,
  pendingEmail: '',
  compositionContextMenu: null,
  setCompositionContextMenu: mockSetCompositionContextMenu,
  isHeaderCollapsed: false,
  setIsHeaderCollapsed: mockSetIsHeaderCollapsed,
  search: '',
  setSearch: mockSetSearch,
  allRecipients: [],
  log: [],
  itemData: {},
  handleCopy: mockHandleCopy,
  executeDraftBridge: mockExecuteDraftBridge,
  handleAddToContacts: mockHandleAddToContacts,
  handleContactSaved: vi.fn(),
};

let asmState = { ...baseAsm };

vi.mock('../../hooks/useAssembler', () => ({
  useAssembler: () => asmState,
}));

// ── helpers ──────────────────────────────────────────────────────────────────
const makeGroup = (id: string, name: string, contacts: string[] = []): BridgeGroup => ({
  id,
  name,
  contacts,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const defaultProps = {
  groups: [makeGroup('g1', 'Alpha', ['a@example.com'])],
  contacts: [] as Contact[],
  onCall: [],
  selectedGroupIds: [] as string[],
  manualAdds: [] as string[],
  manualRemoves: [] as string[],
  onToggleGroup: vi.fn(),
  onAddManual: vi.fn(),
  onRemoveManual: vi.fn(),
  onUndoRemove: vi.fn(),
  onResetManual: vi.fn(),
  setSelectedGroupIds: vi.fn(),
  setManualAdds: vi.fn(),
};

describe('AssemblerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asmState = { ...baseAsm };
  });

  it('renders core layout elements', () => {
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByTestId('assembler-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('composition-list')).toBeInTheDocument();
    expect(screen.getByTestId('list-toolbar')).toBeInTheDocument();
  });

  it('shows recipient count when there are recipients', () => {
    asmState = {
      ...baseAsm,
      allRecipients: [{ email: 'a@example.com', source: 'group' }],
      log: [{ email: 'a@example.com', source: 'group' }],
    };
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByText('1 recipients')).toBeInTheDocument();
  });

  it('shows UNDO button when there are manual removes', () => {
    render(<AssemblerTab {...defaultProps} manualRemoves={['x@example.com']} />);
    expect(screen.getByText('UNDO')).toBeInTheDocument();
  });

  it('calls onResetManual when RESET is clicked', () => {
    const onResetManual = vi.fn();
    render(<AssemblerTab {...defaultProps} onResetManual={onResetManual} />);
    fireEvent.click(screen.getByText('RESET'));
    expect(onResetManual).toHaveBeenCalled();
  });

  it('opens history modal when HISTORY is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('HISTORY'));
    expect(screen.getByTestId('bridge-history-modal')).toBeInTheDocument();
  });

  it('closes history modal when close is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByText('close-history'));
    expect(screen.queryByTestId('bridge-history-modal')).not.toBeInTheDocument();
  });

  it('calls setIsBridgeReminderOpen when DRAFT BRIDGE is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('DRAFT BRIDGE'));
    expect(mockSetIsBridgeReminderOpen).toHaveBeenCalledWith(true);
  });

  it('opens BridgeReminderModal when isBridgeReminderOpen is true', () => {
    asmState = { ...baseAsm, isBridgeReminderOpen: true };
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByTestId('bridge-reminder-modal')).toBeInTheDocument();
  });

  it('calls executeDraftBridge when BridgeReminderModal is confirmed', () => {
    asmState = { ...baseAsm, isBridgeReminderOpen: true };
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('confirm-reminder'));
    expect(mockExecuteDraftBridge).toHaveBeenCalled();
  });

  it('calls handleCopy when COPY is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('COPY'));
    expect(mockHandleCopy).toHaveBeenCalled();
  });

  it('opens SaveGroupModal when "save-as-group" is triggered from history', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByText('save-as-group'));
    expect(screen.getByTestId('save-group-modal')).toBeInTheDocument();
    expect(screen.getByText('Save as Group')).toBeInTheDocument();
  });

  it('calls saveGroup and showToast on successful group save from history', async () => {
    mockSaveGroup.mockResolvedValue({ id: 'g2', name: 'TestGroup', contacts: [] });
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByText('save-as-group'));
    fireEvent.click(screen.getByText('save-group'));
    // Wait for async handler
    await vi.waitFor(() => {
      expect(mockSaveGroup).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Saved group: TestGroup', 'success');
    });
  });

  it('shows error toast when saveGroup fails', async () => {
    mockSaveGroup.mockResolvedValue(null);
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByText('save-as-group'));
    fireEvent.click(screen.getByText('save-group'));
    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to save group', 'error');
    });
  });

  it('handles load from history: calls onResetManual and setSelectedGroupIds', () => {
    const setSelectedGroupIds = vi.fn();
    const onResetManual = vi.fn();
    render(
      <AssemblerTab
        {...defaultProps}
        setSelectedGroupIds={setSelectedGroupIds}
        onResetManual={onResetManual}
      />,
    );
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByText('load-history'));
    expect(onResetManual).toHaveBeenCalled();
    // Alpha is in groups, so g1 should be selected
    expect(setSelectedGroupIds).toHaveBeenCalledWith(['g1']);
  });

  it('shows Manage Groups context menu item when compositionContextMenu is set (known contact)', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 100, y: 200, email: 'known@example.com', isUnknown: false },
    };
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    expect(screen.getByText('Manage Groups')).toBeInTheDocument();
    expect(screen.queryByText('Save to Contacts')).not.toBeInTheDocument();
  });

  it('shows "Save to Contacts" context menu item for unknown contacts', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 100, y: 200, email: 'unknown@example.com', isUnknown: true },
    };
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByText('Save to Contacts')).toBeInTheDocument();
    expect(screen.getByText('Manage Groups')).toBeInTheDocument();
    expect(screen.getByText('Remove from List')).toBeInTheDocument();
  });

  it('calls onRemoveManual when "Remove from List" is clicked in context menu', () => {
    const onRemoveManual = vi.fn();
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 10, y: 10, email: 'x@example.com', isUnknown: false },
    };
    render(<AssemblerTab {...defaultProps} onRemoveManual={onRemoveManual} />);
    fireEvent.click(screen.getByText('Remove from List'));
    expect(onRemoveManual).toHaveBeenCalledWith('x@example.com');
  });

  it('opens GroupSelector modal when "Manage Groups" is clicked', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 10, y: 10, email: 'a@example.com', isUnknown: false },
    };
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Manage Groups'));
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByTestId('group-selector')).toBeInTheDocument();
  });
});
