import React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssemblerTab } from '../AssemblerTab';
import type { useAssembler } from '../../hooks/useAssembler';
import type { BridgeGroup, Contact, BridgeHistoryEntry } from '@shared/ipc';

// ── mock sub-components ─────────────────────────────────────────────────────
vi.mock('../assembler', () => ({
  AssemblerSidebar: () => <div data-testid="assembler-sidebar" />,
  BridgeHandoffModal: ({
    isOpen,
    onClose,
    onCopy,
    onOpenTeams,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onCopy: () => void;
    onOpenTeams: () => void;
  }) =>
    isOpen ? (
      <div data-testid="bridge-handoff-modal">
        <button onClick={onClose}>close-handoff</button>
        <button onClick={onCopy}>copy-from-handoff</button>
        <button data-testid="confirm-teams-handoff" onClick={onOpenTeams}>
          confirm-teams-handoff
        </button>
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
              timestamp: Date.now(),
            })
          }
        >
          load-history
        </button>
        <button
          onClick={() =>
            onLoad({
              id: 'h-manual',
              note: '',
              groups: ['Alpha'],
              contacts: ['a@example.com', 'manual@example.com'],
              recipientCount: 2,
              timestamp: Date.now(),
            })
          }
        >
          load-history-manual
        </button>
        <button
          onClick={() =>
            onSaveAsGroup({
              id: 'h1',
              note: '',
              groups: [],
              contacts: ['x@example.com'],
              recipientCount: 1,
              timestamp: Date.now(),
            })
          }
        >
          save-as-group
        </button>
      </div>
    ) : null,
  CompositionList: ({ onScroll }: { onScroll: (offset: number) => void }) => (
    <div data-testid="composition-list">
      <button onClick={() => onScroll(100)}>scroll-list</button>
    </div>
  ),
  ScheduleBridgeModal: ({
    isOpen,
    onClose,
    attendees,
  }: {
    isOpen: boolean;
    onClose: () => void;
    attendees: { name?: string; email: string }[];
  }) =>
    isOpen ? (
      <div data-testid="schedule-bridge-modal">
        <span>{attendees.map((a) => `${a.name ?? ''}<${a.email}>`).join(';')}</span>
        <button onClick={onClose}>close-schedule</button>
      </div>
    ) : null,
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

vi.mock('../../components/ListToolbar', () => ({
  ListToolbar: ({
    onToggleSortDirection,
    onSortKeyChange,
    disabled,
  }: {
    onToggleSortDirection: () => void;
    onSortKeyChange: (key: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="list-toolbar">
      <span>Sort By</span>
      <button disabled={disabled} onClick={onToggleSortDirection}>
        toggle-sort-dir
      </button>
      <button disabled={disabled} onClick={() => onSortKeyChange('email')}>
        sort-by-email
      </button>
    </div>
  ),
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
    variant,
  }: {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title: string;
    variant?: string;
  }) =>
    isOpen ? (
      <div data-testid="modal" data-variant={variant}>
        <span>{title}</span>
        <button onClick={onClose}>close-modal</button>
        {children}
      </div>
    ) : null,
}));

vi.mock('../../components/directory/GroupSelector', () => ({
  GroupSelector: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="group-selector">
      <button onClick={onClose}>close-group-selector</button>
    </div>
  ),
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
const mockSetIsAddContactModalOpen = vi.fn();
const mockSetCompositionContextMenu = vi.fn();
const mockSetIsHeaderCollapsed = vi.fn();
const mockSetSearch = vi.fn();
const mockSetSortConfig = vi.fn();
const mockHandleCopy = vi.fn().mockResolvedValue(true);
const mockExecuteDraftBridge = vi.fn().mockResolvedValue(true);
const mockHandleAddToContacts = vi.fn();

type AssemblerHookState = ReturnType<typeof useAssembler>;

/**
 * The subset of `useAssembler`'s state that `AssemblerTab` actually consumes,
 * typed from the real hook so fixtures cannot drift from production shapes.
 */
type MockAssemblerState = Pick<
  AssemblerHookState,
  | 'sortConfig'
  | 'setSortConfig'
  | 'isAddContactModalOpen'
  | 'setIsAddContactModalOpen'
  | 'pendingEmail'
  | 'compositionContextMenu'
  | 'setCompositionContextMenu'
  | 'isHeaderCollapsed'
  | 'setIsHeaderCollapsed'
  | 'contactMap'
  | 'handoffSummary'
  | 'bridgeSubject'
  | 'allRecipients'
  | 'log'
  | 'itemData'
  | 'isCopying'
  | 'isOpeningTeams'
  | 'handleCopy'
  | 'executeDraftBridge'
  | 'handleAddToContacts'
  | 'handleContactSaved'
> & {
  search: string;
  setSearch: (value: string) => void;
};

const baseAsm: MockAssemblerState = {
  sortConfig: { key: 'name', direction: 'asc' },
  setSortConfig: mockSetSortConfig,
  isAddContactModalOpen: false,
  setIsAddContactModalOpen: mockSetIsAddContactModalOpen,
  pendingEmail: '',
  compositionContextMenu: null,
  setCompositionContextMenu: mockSetCompositionContextMenu,
  isHeaderCollapsed: false,
  setIsHeaderCollapsed: mockSetIsHeaderCollapsed,
  search: '',
  setSearch: mockSetSearch,
  handoffSummary: {
    recipients: [],
    invalidRecipients: [],
    duplicateCount: 0,
    manualCount: 0,
    groupNames: [],
    isValid: false,
  },
  bridgeSubject: '8/4 -',
  allRecipients: [],
  log: [],
  contactMap: new Map(),
  itemData: {
    log: [],
    contactMap: new Map(),
    groupMap: new Map(),
    onRemoveManual: vi.fn(),
    onAddToContacts: vi.fn(),
    onContextMenu: vi.fn(),
  },
  isCopying: false,
  isOpeningTeams: false,
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
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

const withRecipientState = (): MockAssemblerState => ({
  ...baseAsm,
  allRecipients: [{ email: 'a@example.com', source: 'group' }],
  log: [{ email: 'a@example.com', source: 'group' }],
  handoffSummary: {
    recipients: [
      {
        email: 'a@example.com',
        normalizedEmail: 'a@example.com',
        source: 'group',
        valid: true,
      },
    ],
    invalidRecipients: [],
    duplicateCount: 0,
    manualCount: 0,
    groupNames: ['Alpha'],
    isValid: true,
  },
});

describe('AssemblerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleCopy.mockResolvedValue(true);
    mockExecuteDraftBridge.mockResolvedValue(true);
    mockAddHistory.mockResolvedValue({ id: 'history-1' });
    asmState = { ...baseAsm };
  });

  it('renders core layout elements', () => {
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByTestId('assembler-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('composition-list')).toBeInTheDocument();
    expect(screen.getByTestId('list-toolbar')).toBeInTheDocument();
  });

  it('renders the approved Compose operational hierarchy', () => {
    render(<AssemblerTab {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Bridge Recipient Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Compose actions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Contact groups' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recipients' })).toBeInTheDocument();
    expect(screen.getByText('0 recipients')).toBeInTheDocument();
  });

  it('uses the approved lean Compose action hierarchy', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);

    const copy = screen.getByRole('button', { name: 'Copy Recipients' });
    const teams = screen.getByRole('button', { name: 'Open Teams Draft' });

    expect(screen.getByRole('button', { name: 'History' })).toHaveClass(
      'assembler-utility-action',
      'tactile-button--secondary',
    );
    expect(teams).toHaveClass('tactile-button--primary');
    expect(copy).toHaveClass('tactile-button--secondary');
    expect(copy.compareDocumentPosition(teams)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole('button', { name: /^Schedule$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ready ·/)).not.toBeInTheDocument();
  });

  it('matches the operational toolbar spacing and control geometry', () => {
    const css = readFileSync('src/renderer/src/tabs/assembler/assembler.css', 'utf8');
    const commandBarRule =
      /\.assembler-command-bar \.collapsible-header\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';
    const utilityRule =
      /\.assembler-utility-action\.tactile-button\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';
    const workflowRule = /\.assembler-command-group--workflow\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';
    const bridgeRule = /\.assembler-bridge-actions\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';

    expect(commandBarRule).toContain('padding: 0;');
    expect(commandBarRule).toContain('border-bottom: 0;');
    expect(utilityRule).toContain('height: 36px;');
    expect(utilityRule).toContain('padding: 0 var(--space-3);');
    expect(workflowRule).toContain('gap: var(--space-4);');
    expect(bridgeRule).toContain('gap: var(--space-2);');
  });

  it('defines a prominent non-blocking recording notice and recipient-pane sort layout', () => {
    const css = readFileSync('src/renderer/src/tabs/assembler/assembler.css', 'utf8');
    const recording = /\.bridge-handoff-recording\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';
    const paneTools = /\.assembler-pane-tools\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';

    expect(recording).toContain('border-left: 4px solid');
    expect(recording).toContain('var(--color-warning');
    expect(paneTools).toContain('display: flex');
    expect(css).not.toContain('.assembler-page-state-dot');
  });

  it('places sorting inside the Recipients region rather than the command toolbar', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);

    const recipients = screen.getByRole('region', { name: 'Recipients' });
    const actionsToolbar = screen.getByRole('toolbar', { name: 'Compose actions' });
    expect(within(recipients).getByTestId('list-toolbar')).toBeInTheDocument();
    expect(within(actionsToolbar).queryByTestId('list-toolbar')).not.toBeInTheDocument();
  });

  it('derives Compose header and pane counts from current recipients', () => {
    asmState = withRecipientState();

    render(<AssemblerTab {...defaultProps} />);

    expect(screen.getByText('1 recipient')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recipients' })).toHaveTextContent('1 selected');
  });

  it('shows recipient count when there are recipients', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);
    expect(screen.getByText('Recipients')).toBeInTheDocument();
    expect(screen.getByText('1 recipient')).toBeInTheDocument();
  });

  it('shows UNDO button when there are manual removes', () => {
    render(<AssemblerTab {...defaultProps} manualRemoves={['x@example.com']} />);
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('calls onResetManual when RESET is clicked', () => {
    const onResetManual = vi.fn();
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} onResetManual={onResetManual} />);
    fireEvent.click(screen.getByText('Reset'));
    expect(onResetManual).toHaveBeenCalled();
  });

  it('disables zero-recipient actions that cannot do useful work', () => {
    render(<AssemblerTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Reset/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Recipients' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open Teams Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More Compose actions' })).toBeDisabled();
    expect(screen.getByText('toggle-sort-dir')).toBeDisabled();
    expect(screen.getByText('sort-by-email')).toBeDisabled();
  });

  it('enables recipient actions once recipients exist', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Reset/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Recipients' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open Teams Draft' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'More Compose actions' })).not.toBeDisabled();
  });

  it('opens Create Calendar Invite from the accessible More menu', () => {
    asmState = {
      ...withRecipientState(),
      contactMap: new Map([
        [
          'a@example.com',
          {
            name: 'Alice',
            email: 'a@example.com',
            phone: '',
            title: '',
            _searchString: 'alice a@example.com',
            raw: {},
          },
        ],
      ]),
    };
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'More Compose actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Calendar Invite' }));

    expect(screen.getByTestId('schedule-bridge-modal')).toBeInTheDocument();
    expect(screen.getByText('Alice<a@example.com>')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-schedule'));
    expect(screen.queryByTestId('schedule-bridge-modal')).not.toBeInTheDocument();
  });

  it('opens history modal when HISTORY is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('History'));
    expect(screen.getByTestId('bridge-history-modal')).toBeInTheDocument();
  });

  it('closes history modal when close is clicked', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('History'));
    fireEvent.click(screen.getByText('close-history'));
    expect(screen.queryByTestId('bridge-history-modal')).not.toBeInTheDocument();
  });

  it('opens the review before requesting Teams', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    expect(screen.getByTestId('bridge-handoff-modal')).toBeInTheDocument();
    expect(mockExecuteDraftBridge).not.toHaveBeenCalled();
  });

  it('calls handleCopy when Copy Recipients is clicked', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));
    expect(mockHandleCopy).toHaveBeenCalled();
  });

  it('saves history only after a successful copy', async () => {
    mockHandleCopy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} selectedGroupIds={['g1']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));
    await waitFor(() => expect(mockHandleCopy).toHaveBeenCalledTimes(1));
    expect(mockAddHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));
    await waitFor(() => expect(mockAddHistory).toHaveBeenCalledTimes(1));
  });

  it('closes the review after an accepted Teams request and does not save failure', async () => {
    mockExecuteDraftBridge.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} selectedGroupIds={['g1']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    fireEvent.click(screen.getByTestId('confirm-teams-handoff'));
    await waitFor(() => expect(mockExecuteDraftBridge).toHaveBeenCalledTimes(1));
    expect(mockAddHistory).not.toHaveBeenCalled();
    expect(screen.getByTestId('bridge-handoff-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-teams-handoff'));
    await waitFor(() => expect(mockAddHistory).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('bridge-handoff-modal')).not.toBeInTheDocument();
  });

  it('saves an unchanged composition only once across copy and Teams actions', async () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} selectedGroupIds={['g1']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));
    await waitFor(() => expect(mockAddHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    fireEvent.click(screen.getByTestId('confirm-teams-handoff'));
    await waitFor(() => expect(mockExecuteDraftBridge).toHaveBeenCalledTimes(1));
    expect(mockAddHistory).toHaveBeenCalledTimes(1);
  });

  it('opens SaveGroupModal when "save-as-group" is triggered from history', () => {
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('History'));
    fireEvent.click(screen.getByText('save-as-group'));
    expect(screen.getByTestId('save-group-modal')).toBeInTheDocument();
    expect(screen.getByText('Save as Group')).toBeInTheDocument();
  });

  it('calls saveGroup and showToast on successful group save from history', async () => {
    mockSaveGroup.mockResolvedValue({ id: 'g2', name: 'TestGroup', contacts: [] });
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('History'));
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
    fireEvent.click(screen.getByText('History'));
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
    fireEvent.click(screen.getByText('History'));
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
    expect(screen.getByTestId('modal')).toHaveAttribute('data-variant', 'confirmation');
    expect(screen.getByTestId('group-selector')).toBeInTheDocument();
  });

  it('reports a history failure after recipients were copied', async () => {
    mockAddHistory.mockRejectedValueOnce(new Error('history failed'));
    asmState = withRecipientState();

    render(<AssemblerTab {...defaultProps} selectedGroupIds={['g1', 'missing-group']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Recipients copied, but history could not be saved: history failed',
        'error',
      );
    });
  });

  it('reports a history failure after an accepted Teams request', async () => {
    mockAddHistory.mockRejectedValueOnce(new Error('draft history failed'));
    asmState = withRecipientState();

    render(<AssemblerTab {...defaultProps} selectedGroupIds={['g1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    fireEvent.click(screen.getByTestId('confirm-teams-handoff'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Teams draft requested, but history could not be saved: draft history failed',
        'error',
      );
    });
  });

  it('applies manual contacts from history entries not in selected groups', () => {
    const setManualAdds = vi.fn();
    render(<AssemblerTab {...defaultProps} setManualAdds={setManualAdds} />);

    fireEvent.click(screen.getByText('History'));
    fireEvent.click(screen.getByText('load-history-manual'));

    expect(setManualAdds).toHaveBeenCalledWith(['manual@example.com']);
  });

  it('updates sort config from toolbar controls', () => {
    asmState = {
      ...baseAsm,
      allRecipients: [{ email: 'a@example.com', source: 'group' }],
      log: [{ email: 'a@example.com', source: 'group' }],
    };
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('toggle-sort-dir'));
    fireEvent.click(screen.getByText('sort-by-email'));

    expect(mockSetSortConfig).toHaveBeenCalledTimes(2);
  });

  it('collapses header on composition list scroll', () => {
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('scroll-list'));
    expect(mockSetIsHeaderCollapsed).toHaveBeenCalledWith(true);
  });

  it('closes add contact modal when close callback fires', () => {
    asmState = { ...baseAsm, isAddContactModalOpen: true };
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('close-add-contact'));
    expect(mockSetIsAddContactModalOpen).toHaveBeenCalledWith(false);
  });

  it('closes the Teams handoff review from its close callback', () => {
    asmState = withRecipientState();
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    fireEvent.click(screen.getByText('close-handoff'));
    expect(screen.queryByTestId('bridge-handoff-modal')).not.toBeInTheDocument();
  });

  it('closes save-group modal from history action', () => {
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('History'));
    fireEvent.click(screen.getByText('save-as-group'));
    expect(screen.getByTestId('save-group-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-save'));
    expect(screen.queryByTestId('save-group-modal')).not.toBeInTheDocument();
  });

  it('handles context menu close and save-to-contacts action', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 10, y: 10, email: 'unknown@example.com', isUnknown: true },
    };
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('Save to Contacts'));
    expect(mockHandleAddToContacts).toHaveBeenCalledWith('unknown@example.com');
    expect(mockSetCompositionContextMenu).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText('close-ctx'));
    expect(mockSetCompositionContextMenu).toHaveBeenCalledWith(null);
  });

  it('closes manage groups modal from modal close handler', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 10, y: 10, email: 'a@example.com', isUnknown: false },
    };
    render(<AssemblerTab {...defaultProps} />);

    fireEvent.click(screen.getByText('Manage Groups'));
    expect(screen.getByTestId('group-selector')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-modal'));
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('closes manage groups modal from group selector close handler', () => {
    asmState = {
      ...baseAsm,
      compositionContextMenu: { x: 10, y: 10, email: 'a@example.com', isUnknown: false },
    };
    render(<AssemblerTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Manage Groups'));
    fireEvent.click(screen.getByText('close-group-selector'));
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });
});
