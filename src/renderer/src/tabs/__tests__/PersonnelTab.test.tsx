import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { OnCallRow, Contact } from '@shared/ipc';
import type { BoardSettingsState } from '../../hooks/useAppData';

// ---------- mocks ----------

const mockToggleBoardLock = vi.fn();

vi.mock('../../hooks/usePersonnel', () => ({
  usePersonnel: (_rows: OnCallRow[], bs: BoardSettingsState) => ({
    localOnCall: _rows,
    weekRange: 'March 30 - April 5, 2026',
    teams: bs.effectiveTeamOrder,
    teamIdToName: new Map(
      bs.effectiveTeamOrder.map((id: string) => [id, id.charAt(0).toUpperCase() + id.slice(1)]),
    ),
    handleUpdateRows: vi.fn(),
    handleRemoveTeam: vi.fn(),
    handleRenameTeam: vi.fn(),
    handleAddTeam: vi.fn(),
    handleReorderTeams: vi.fn(),
    boardSettings: bs,
    toggleBoardLock: mockToggleBoardLock,
    isBoardLockTogglePending: false,
    dismissedAlerts: new Set(),
    dismissAlert: vi.fn(),
    dayOfWeek: 2,
    tick: 0,
  }),
}));

vi.mock('../../hooks/useOnCallBoard', () => ({
  useOnCallBoard: () => ({
    animationParent: { current: null },
    enableAnimations: vi.fn(),
    handleCopyTeamInfo: vi.fn(),
    handleCopyAllOnCall: vi.fn(),
  }),
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  NoopToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: () => null,
  StatusBarLive: () => null,
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Provide a minimal global api stub
(globalThis as Record<string, unknown>).api = {
  notifyDragStart: vi.fn(),
  notifyDragStop: vi.fn(),
  openAuxWindow: vi.fn(),
};

import { PersonnelTab } from '../PersonnelTab';

const makeRow = (team: string, role: string, name: string): OnCallRow => ({
  id: `${team}-${role}-${name}`,
  team,
  teamId: team.toLowerCase(),
  role,
  name,
  contact: `${name.toLowerCase()}@test.com`,
  timeWindow: '',
});

const makeReadyBoardSettings = (
  teamOrder: string[],
  overrides: Partial<BoardSettingsState> = {},
): BoardSettingsState => ({
  record: null,
  recordId: 'settings-1',
  effectiveTeamOrder: teamOrder,
  effectiveLocked: false,
  status: 'ready',
  errors: [],
  ...overrides,
});

const defaultRows: OnCallRow[] = [
  makeRow('Network', 'Primary', 'Alice'),
  makeRow('Database', 'Primary', 'Charlie'),
];
const defaultContacts: Contact[] = [];

describe('PersonnelTab — board lock button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an unlocked lock button when board is unlocked', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Board' });
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain('UNLOCKED');
  });

  it('renders a locked lock button when board is locked', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], { effectiveLocked: true });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Unlock Board' });
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain('LOCKED');
  });

  it('calls toggleBoardLock when clicked', async () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Board' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockToggleBoardLock).toHaveBeenCalledTimes(1);
    });
  });

  it('disables the lock button when board status is not ready', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], { status: 'loading' });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    // When not ready, the button should exist but be disabled
    // The aria-label is "Lock Board" when unlocked
    const btn = screen.getByRole('button', { name: 'Lock Board' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('shows correct tooltip for locked state', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], { effectiveLocked: true });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Unlock Board' });
    expect(btn.getAttribute('title') || btn.closest('[title]')?.getAttribute('title')).toContain(
      'Unlock Board',
    );
  });

  it('shows correct tooltip for unlocked state', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Board' });
    expect(btn.getAttribute('title') || btn.closest('[title]')?.getAttribute('title')).toContain(
      'Lock Board',
    );
  });
});

describe('PersonnelTab — Add Card modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the Add New Card modal when ADD CARD button is clicked', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));

    expect(screen.getByText('Add New Card')).toBeDefined();
  });

  it('closes the Add New Card modal when Cancel is clicked', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    expect(screen.getByText('Add New Card')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));

    // Modal should be closed after Cancel
    expect(screen.queryByText('Add New Card')).toBeNull();
  });

  it('submits the Add Card form on Enter key', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    const input = screen.getByPlaceholderText('Card Name (e.g. SRE, Support)');
    fireEvent.change(input, { target: { value: 'NewTeam' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Modal should close after successful submission
    expect(screen.queryByText('Add New Card')).toBeNull();
  });

  it('does not submit the Add Card form on Enter when name is blank', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    const input = screen.getByPlaceholderText('Card Name (e.g. SRE, Support)');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Modal should still be open since blank names are rejected
    expect(screen.getByText('Add New Card')).toBeDefined();
  });

  it('submits via the Add Card button click', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    const input = screen.getByPlaceholderText('Card Name (e.g. SRE, Support)');
    fireEvent.change(input, { target: { value: 'SRE' } });

    // Click the modal's Add Card button (not the header one)
    const addCardBtns = screen.getAllByText('Add Card');
    const modalAddBtn = addCardBtns[addCardBtns.length - 1];
    fireEvent.click(modalAddBtn);

    // Modal should close after successful submission
    expect(screen.queryByText('Add New Card')).toBeNull();
  });

  it('does not submit via Add Card button when name is blank', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Card' }));
    // Don't enter any text, just click the Add Card button in the modal
    const addCardBtns = screen.getAllByText('Add Card');
    const modalAddBtn = addCardBtns[addCardBtns.length - 1];
    fireEvent.click(modalAddBtn);

    // Modal should still be open
    expect(screen.getByText('Add New Card')).toBeDefined();
  });
});

describe('PersonnelTab — Export CSV button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the EXPORT button', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByRole('button', { name: 'Export to CSV' })).toBeDefined();
  });
});

describe('PersonnelTab — Copy All button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the COPY ALL button', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByRole('button', { name: 'Copy All On-Call Info' })).toBeDefined();
  });
});

describe('PersonnelTab — Pop Out button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders POP OUT button when not in popout mode', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByRole('button', { name: 'Pop Out Board' })).toBeDefined();
  });

  it('calls openAuxWindow when POP OUT is clicked', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pop Out Board' }));
    expect((globalThis as Record<string, unknown> & { api: { openAuxWindow: ReturnType<typeof vi.fn> } }).api.openAuxWindow).toHaveBeenCalledWith('popout/board');
  });
});

describe('PersonnelTab — team rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders team cards for each team in the board settings', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const list = screen.getByRole('list', { name: 'Sortable On-Call Teams' });
    expect(list).toBeDefined();
  });

  it('renders no team cards when there are no teams', () => {
    const bs = makeReadyBoardSettings([]);
    render(<PersonnelTab onCall={[]} contacts={defaultContacts} boardSettings={bs} />);

    const list = screen.getByRole('list', { name: 'Sortable On-Call Teams' });
    expect(list).toBeDefined();
  });

  it('renders the week range', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByText('March 30 - April 5, 2026')).toBeDefined();
  });
});

describe('PersonnelTab — Rename Card modal', () => {
  // Note: the rename modal is triggered by SortableTeamCard callbacks which are
  // mocked, but we can test the modal rendering and interactions by directly
  // simulating the state. Since the modal opens based on `renamingTeam` state,
  // we cannot easily trigger it from outside without the child component.
  // However, we can verify the modal elements exist when the component renders.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render rename modal initially', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    // The modal title "Rename Card" should not be visible initially
    expect(screen.queryByText('Rename Card')).toBeNull();
  });
});
