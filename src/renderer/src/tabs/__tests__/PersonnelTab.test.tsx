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
