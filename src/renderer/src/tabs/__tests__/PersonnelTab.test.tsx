import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { OnCallRow, Contact } from '@shared/ipc';
import type { BoardSettingsState } from '../../hooks/useAppData';

// ---------- mocks ----------

const mockToggleBoardLock = vi.fn();
const mockHandleAddTeam = vi.fn<(name: string) => Promise<{ ok: boolean; error?: string }>>();
const mockDismissAlert = vi.fn();
const mockReminderDay = { current: 2 };

vi.mock('../../hooks/usePersonnel', () => ({
  usePersonnel: (_rows: OnCallRow[], bs: BoardSettingsState) => ({
    localOnCall: _rows,
    weekRange: 'March 30 – April 5, 2026',
    teams: bs.effectiveTeamOrder,
    teamIdToName: new Map(
      bs.effectiveTeamOrder.map((id: string) => [id, id.charAt(0).toUpperCase() + id.slice(1)]),
    ),
    handleUpdateRows: vi.fn(),
    handleRemoveTeam: vi.fn(),
    handleRenameTeam: vi.fn(),
    handleAddTeam: mockHandleAddTeam,
    handleReorderTeams: vi.fn(),
    boardSettings: bs,
    toggleBoardLock: mockToggleBoardLock,
    isBoardLockTogglePending: false,
    dismissedAlerts: new Set(),
    dismissAlert: mockDismissAlert,
    dayOfWeek: mockReminderDay.current,
    tick: 0,
  }),
}));

// useAutoAnimate — and therefore useOnCallBoard — hands back a ref *callback*, not a ref object.
// The stub mirrors that so the board cannot regress to assigning `.current` onto it.
const mockAnimationParent = vi.fn<(node: Element | null) => void>();

vi.mock('../../hooks/useOnCallBoard', () => ({
  useOnCallBoard: () => ({
    animationParent: mockAnimationParent,
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

describe('PersonnelTab — page header and command toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the shared tab hierarchy without dropping or restyling its actions', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    const { container } = render(
      <PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'On-Call' });
    expect(heading).toHaveClass('tab-page-header__title');
    expect(screen.queryByRole('button', { name: 'Confirm Coverage' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Current week March 30 – April 5, 2026').closest('.tab-page-header__meta'),
    ).not.toBeNull();

    const toolbar = screen.getByRole('toolbar', { name: 'On-call actions' });
    const utilityGroup = container.querySelector<HTMLElement>('.tab-command-group--utility');
    const workflowGroup = container.querySelector<HTMLElement>('.tab-command-group--workflow');
    expect(toolbar).toContainElement(utilityGroup);
    expect(toolbar).toContainElement(workflowGroup);
    // The font scale sits behind one Text Size command instead of spending three controls.
    expect(screen.queryByRole('group', { name: 'Board text size' })).not.toBeInTheDocument();
    const display = screen.getByRole('button', { name: /^Text Size/ });
    expect(utilityGroup).toContainElement(display);
    // The view option follows the repeated actions instead of taking the first slot.
    expect(
      screen.getByRole('button', { name: 'Export to CSV' }).compareDocumentPosition(display) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const name of ['Copy All On-Call Info', 'Export to CSV']) {
      const button = screen.getByRole('button', { name });
      expect(toolbar).toContainElement(button);
      expect(button).toHaveClass('tactile-button--secondary', 'oncall-command-action');
    }

    expect(utilityGroup).toContainElement(screen.getByRole('button', { name: 'Export to CSV' }));
    expect(workflowGroup).toContainElement(screen.getByRole('button', { name: 'Lock Order' }));
    expect(screen.getByRole('button', { name: 'Lock Order' })).toHaveTextContent('Lock Order');

    const addTeam = screen.getByRole('button', { name: 'Add Team' });
    expect(toolbar).toContainElement(addTeam);
    expect(addTeam).toHaveClass('tactile-button--primary');
  });
});

describe('PersonnelTab — board lock button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an unlocked lock button when board is unlocked', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Order' });
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain('Lock Order');
    // The icon shows the state the action produces, not the current one.
    expect(btn.querySelector('svg')).toHaveAttribute('data-icon', 'lock-closed');
  });

  it('renders a locked lock button when board is locked', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], { effectiveLocked: true });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Unlock Order' });
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain('Unlock Order');
    expect(btn.querySelector('svg')).toHaveAttribute('data-icon', 'lock-open');
  });

  it('calls toggleBoardLock when clicked', async () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Order' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockToggleBoardLock).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the lock button enabled when a settings record exists but board status is not ready', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], {
      status: 'invalid',
      errors: ['Team order needs repair'],
    });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Order' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('keeps the lock button enabled when no board settings record exists yet', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], {
      status: 'loading',
      recordId: null,
    });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Order' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows correct tooltip for locked state', () => {
    const bs = makeReadyBoardSettings(['network', 'database'], { effectiveLocked: true });
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Unlock Order' });
    expect(btn).not.toHaveAttribute('title');
    fireEvent.mouseEnter(btn);
    expect(document.querySelector('.tooltip-popup')).toHaveTextContent('Unlock Order');
  });

  it('shows correct tooltip for unlocked state', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const btn = screen.getByRole('button', { name: 'Lock Order' });
    expect(btn).not.toHaveAttribute('title');
    fireEvent.mouseEnter(btn);
    expect(document.querySelector('.tooltip-popup')).toHaveTextContent('Lock Order');
  });
});

describe('PersonnelTab — Add Team modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleAddTeam.mockResolvedValue({ ok: true });
  });

  it('opens the Add Team modal when the Add Team button is clicked', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));

    expect(screen.getByRole('dialog', { name: 'Add team' })).toHaveAttribute(
      'data-variant',
      'standard',
    );
  });

  it('closes the Add Team modal when Cancel is clicked', async () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    expect(screen.getByRole('dialog', { name: 'Add team' })).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));

    // Modal should be closed after Cancel
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add team' })).toBeNull());
  });

  it('submits the Add Card form on Enter key', async () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    const input = screen.getByLabelText('Team name');
    fireEvent.change(input, { target: { value: 'NewTeam' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Modal should close after successful submission
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add team' })).toBeNull());
  });

  it('does not submit the Add Card form on Enter when name is blank', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    const input = screen.getByLabelText('Team name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Modal should still be open since blank names are rejected
    expect(screen.getByRole('dialog', { name: 'Add team' })).toBeDefined();
  });

  it('submits via the Add Card button click', async () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    const input = screen.getByLabelText('Team name');
    fireEvent.change(input, { target: { value: 'SRE' } });

    const modalAddBtn = within(screen.getByRole('dialog', { name: 'Add team' })).getByRole(
      'button',
      { name: 'Add Team' },
    );
    fireEvent.click(modalAddBtn);

    // Modal should close after successful submission
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add team' })).toBeNull());
  });

  it('does not submit via Add Card button when name is blank', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    // Don't enter any text, just click the Add Team button in the modal
    const modalAddBtn = within(screen.getByRole('dialog', { name: 'Add team' })).getByRole(
      'button',
      { name: 'Add Team' },
    );
    fireEvent.click(modalAddBtn);

    // Modal should still be open
    expect(screen.getByRole('dialog', { name: 'Add team' })).toBeDefined();
    expect(mockHandleAddTeam).not.toHaveBeenCalled();
  });

  it('keeps the modal open with an inline error when the team name already exists', async () => {
    mockHandleAddTeam.mockResolvedValue({
      ok: false,
      error: 'A team named "Network" already exists',
    });
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    const input = screen.getByLabelText('Team name');
    fireEvent.change(input, { target: { value: 'network' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A team named "Network" already exists',
    );
    expect(mockHandleAddTeam).toHaveBeenCalledWith('network');
    expect(screen.getByRole('dialog', { name: 'Add team' })).toBeInTheDocument();
    expect(input).toHaveValue('network');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    // Editing the name clears the stale error.
    fireEvent.change(input, { target: { value: 'Network 2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the modal open without closing when adding fails', async () => {
    mockHandleAddTeam.mockResolvedValue({ ok: false });
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
    const input = screen.getByLabelText('Team name');
    fireEvent.change(input, { target: { value: 'SRE' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockHandleAddTeam).toHaveBeenCalledWith('SRE'));
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(screen.getByRole('dialog', { name: 'Add team' })).toBeInTheDocument();
    expect(input).toHaveValue('SRE');
  });
});

describe('PersonnelTab — Remove Team confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('states how many members are removed and uses the danger action', async () => {
    const bs = makeReadyBoardSettings(['network']);
    const rows = [
      makeRow('Network', 'Primary', 'Alice'),
      makeRow('Network', 'Backup', 'Bob'),
      makeRow('Network', 'Member', 'Cara'),
    ];
    render(<PersonnelTab onCall={rows} contacts={defaultContacts} boardSettings={bs} />);

    fireEvent.click(screen.getByRole('button', { name: /^Network Team Actions:/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Team' }));

    const dialog = await screen.findByRole('dialog', { name: 'Remove team' });
    expect(dialog).toHaveTextContent(
      'Remove the team "Network"? This also removes its 3 members. You can undo this from the notice that follows.',
    );
    expect(within(dialog).getByRole('button', { name: 'Remove Team' })).toHaveClass(
      'tactile-button--danger',
    );
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

describe('PersonnelTab — command bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The board no longer opens in a second window: the aux-window IPC route it
  // used was removed along with it, so a reintroduced button would send to a
  // channel the main process does not register.
  it('offers no pop-out control', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.queryByRole('button', { name: /pop ?out/i })).toBeNull();
  });
});

describe('PersonnelTab — team rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the selected board font scale as a scoped CSS variable', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    const { container } = render(
      <PersonnelTab
        onCall={defaultRows}
        contacts={defaultContacts}
        boardSettings={bs}
        onCallFontScale={125}
      />,
    );

    expect(container.querySelector('.personnel-tab-root')).toHaveStyle({
      '--oncall-font-scale': '1.25',
    });
  });

  it('renders an adjustable board font scale control that reports stepper changes', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    const onOnCallFontScaleChange = vi.fn();
    render(
      <PersonnelTab
        onCall={defaultRows}
        contacts={defaultContacts}
        boardSettings={bs}
        onCallFontScale={125}
        onOnCallFontScaleChange={onOnCallFontScaleChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Text Size 125%' }));
    const group = within(screen.getByRole('dialog', { name: 'Text size' })).getByRole('group', {
      name: 'Board text size',
    });
    expect(within(group).getByText('125%')).toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: 'Larger text' }));

    expect(onOnCallFontScaleChange).toHaveBeenCalledWith(130);
  });

  it('renders team cards for each team in the board settings', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const list = screen.getByRole('list', { name: 'Sortable On-Call Teams' });
    expect(list).toBeDefined();
  });

  // Regression: the board used to assign `animationParent.current = node`. useAutoAnimate hands
  // back a ref callback, so that only decorated the function object and auto-animate never saw
  // the grid — the board silently lost every reorder/add/remove transition.
  it('registers the masonry grid with auto-animate by calling the ref callback', () => {
    const bs = makeReadyBoardSettings(['network', 'database']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    const list = screen.getByRole('list', { name: 'Sortable On-Call Teams' });
    expect(mockAnimationParent).toHaveBeenCalledWith(list);
  });

  it('explains an empty board and disables actions that require team data', () => {
    const bs = makeReadyBoardSettings([]);
    render(
      <PersonnelTab
        onCall={[]}
        contacts={defaultContacts}
        boardSettings={bs}
        onOnCallFontScaleChange={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: 'Sortable On-Call Teams' });
    expect(within(list).getByRole('heading', { name: 'No on-call teams' })).toBeInTheDocument();
    expect(within(list).getByText('Use Add Team to start the board.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy All On-Call Info' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export to CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lock Order' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Team' })).toBeEnabled();

    const display = screen.getByRole('button', { name: /^Text Size/ });
    expect(display).toBeDisabled();
    fireEvent.click(display);
    expect(screen.queryByRole('dialog', { name: 'Text size' })).not.toBeInTheDocument();
  });

  it('renders the week range', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByText('Current week March 30 – April 5, 2026')).toBeDefined();
  });

  it('shows the weekly reminder as status text with a separate dismiss button', () => {
    mockReminderDay.current = 3;
    try {
      const bs = makeReadyBoardSettings(['network']);
      render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

      const reminder = screen.getByText('Update SQL DBA').closest<HTMLElement>('[role="status"]');
      expect(reminder).toHaveClass('personnel-alert', 'personnel-alert--danger');
      fireEvent.click(
        within(reminder!).getByRole('button', { name: 'Dismiss reminder: Update SQL DBA' }),
      );
      expect(mockDismissAlert).toHaveBeenCalledWith('sql');
    } finally {
      mockReminderDay.current = 2;
    }
  });

  it('renders the last-updated timestamp in the standard header', () => {
    const bs = makeReadyBoardSettings(['network']);
    render(<PersonnelTab onCall={defaultRows} contacts={defaultContacts} boardSettings={bs} />);

    expect(screen.getByText('Last edited Unknown')).toBeDefined();
  });
});

describe('PersonnelTab — Rename Team modal', () => {
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

    // The modal title "Rename team" should not be visible initially
    expect(screen.queryByText('Rename team')).toBeNull();
  });
});

it('does not invent a saved edit time on reload', () => {
  render(
    <PersonnelTab
      onCall={[]}
      contacts={[]}
      boardSettings={{
        record: null,
        recordId: null,
        effectiveTeamOrder: [],
        effectiveLocked: true,
        status: 'loading',
        errors: [],
      }}
    />,
  );
  expect(screen.getByText('Last edited Unknown')).toBeInTheDocument();
});

it('retains the saved edit time when the board reloads later', () => {
  const saved = Date.parse('2026-03-01T12:00:00Z');
  const bs = makeReadyBoardSettings(['network']);
  const rows = [{ ...defaultRows[0]!, updatedAt: saved }];
  const expected = new Date(saved).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const { unmount } = render(<PersonnelTab onCall={rows} contacts={[]} boardSettings={bs} />);
  expect(screen.getByText(`Last edited ${expected}`)).toBeInTheDocument();
  unmount();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
  render(<PersonnelTab onCall={[...rows]} contacts={[]} boardSettings={bs} />);
  expect(screen.getByText(`Last edited ${expected}`)).toBeInTheDocument();
  vi.useRealTimers();
});
