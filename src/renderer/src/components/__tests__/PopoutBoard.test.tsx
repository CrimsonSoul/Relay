import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stable mock return value — avoids infinite re-render loops caused by
// new array/map references on every call to the hook.
const STABLE_ON_CALL: never[] = [];
const STABLE_DISMISSED = new Set<string>();
const STABLE_TEAMS = ['team-1'];
const STABLE_TEAM_MAP = new Map([['team-1', 'Alpha Team']]);

const personnelReturn = {
  localOnCall: STABLE_ON_CALL,
  weekRange: 'Jan 1 - Jan 7',
  dismissedAlerts: STABLE_DISMISSED,
  dayOfWeek: 2,
  teams: STABLE_TEAMS,
  teamIdToName: STABLE_TEAM_MAP,
  tick: 0,
};

vi.mock('../../hooks/usePersonnel', () => ({
  usePersonnel: () => personnelReturn,
}));

vi.mock('../../hooks/useOnCallBoard', () => ({
  useOnCallBoard: () => ({
    animationParent: { current: null },
    handleCopyTeamInfo: vi.fn(),
    handleCopyAllOnCall: vi.fn(),
  }),
}));

vi.mock('../CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
  useCollapsibleHeader: () => ({
    isCollapsed: false,
    scrollContainerRef: { current: null },
  }),
}));

vi.mock('../personnel/TeamCard', () => ({
  TeamCard: ({ team }: { team: string }) => <div data-testid="team-card">{team}</div>,
}));

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('../ContextMenu', () => ({
  ContextMenu: () => null,
  ContextMenuItem: () => null,
}));

import { PopoutBoard } from '../PopoutBoard';

const defaultProps = {
  onCall: [],
  contacts: [],
  boardSettings: { teamOrder: [], hiddenTeams: [], customNames: {} },
};

describe('PopoutBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).api = {
      onDragStateChange: vi.fn(() => vi.fn()),
      platform: 'darwin',
    };
  });

  it('renders the board container', () => {
    const { container } = render(<PopoutBoard {...defaultProps} />);
    expect(container.querySelector('.popout-board')).toBeInTheDocument();
  });

  it('renders the collapsible header with week range', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByTestId('collapsible-header')).toBeInTheDocument();
    expect(screen.getByText('Jan 1 - Jan 7')).toBeInTheDocument();
  });

  it('renders team cards in masonry layout', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByTestId('team-card')).toBeInTheDocument();
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
  });

  it('renders masonry grid with aria-label', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByLabelText('On-Call Teams')).toBeInTheDocument();
  });

  it('renders KIOSK button', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText('KIOSK')).toBeInTheDocument();
  });

  it('renders COPY ALL button', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText('COPY ALL')).toBeInTheDocument();
  });

  it('enters kiosk mode on KIOSK click', () => {
    render(<PopoutBoard {...defaultProps} />);
    fireEvent.click(screen.getByText('KIOSK'));
    expect(screen.getByText('Exit Kiosk')).toBeInTheDocument();
  });

  it('exits kiosk mode on Exit Kiosk click', () => {
    render(<PopoutBoard {...defaultProps} />);
    fireEvent.click(screen.getByText('KIOSK'));
    expect(screen.getByText('Exit Kiosk')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Exit Kiosk'));
    expect(screen.getByText('KIOSK')).toBeInTheDocument();
  });

  it('shows last updated timestamp', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('does not show drag overlay by default', () => {
    const { container } = render(<PopoutBoard {...defaultProps} />);
    expect(container.querySelector('.popout-drag-overlay')).not.toBeInTheDocument();
  });

  it('does not show kiosk controls by default', () => {
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.queryByText('Exit Kiosk')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last Update:/)).not.toBeInTheDocument();
  });

  it('shows kiosk controls when in kiosk mode', () => {
    render(<PopoutBoard {...defaultProps} />);
    fireEvent.click(screen.getByText('KIOSK'));
    expect(screen.getByText(/Last Update:/)).toBeInTheDocument();
    expect(screen.getByText('Exit Kiosk')).toBeInTheDocument();
  });

  it('hides collapsible header in kiosk mode', () => {
    render(<PopoutBoard {...defaultProps} />);
    fireEvent.click(screen.getByText('KIOSK'));
    // The header with KIOSK and COPY ALL buttons should be hidden
    expect(screen.queryByText('COPY ALL')).not.toBeInTheDocument();
  });

  it('renders alert chips when day matches alert config', () => {
    // dayOfWeek is 2 in the mock, no alerts are configured for day 2
    render(<PopoutBoard {...defaultProps} />);
    // No alert chips should be shown for day 2
    expect(screen.queryByText('Update First Responder')).not.toBeInTheDocument();
    expect(screen.queryByText('Update Weekly Schedule')).not.toBeInTheDocument();
  });

  it('renders alert chip for day 0 (first-responder)', () => {
    personnelReturn.dayOfWeek = 0;
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText('Update First Responder')).toBeInTheDocument();
    // Restore
    personnelReturn.dayOfWeek = 2;
  });

  it('renders alert chip for day 1 (general)', () => {
    personnelReturn.dayOfWeek = 1;
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText('Update Weekly Schedule')).toBeInTheDocument();
    personnelReturn.dayOfWeek = 2;
  });

  it('renders danger alert chips for day 3 and 4', () => {
    personnelReturn.dayOfWeek = 3;
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.getByText('Update SQL DBA')).toBeInTheDocument();
    personnelReturn.dayOfWeek = 2;
  });

  it('does not render dismissed alerts', () => {
    personnelReturn.dayOfWeek = 0;
    personnelReturn.dismissedAlerts = new Set(['first-responder']);
    render(<PopoutBoard {...defaultProps} />);
    expect(screen.queryByText('Update First Responder')).not.toBeInTheDocument();
    // Restore
    personnelReturn.dayOfWeek = 2;
    personnelReturn.dismissedAlerts = STABLE_DISMISSED;
  });

  it('handles undefined api gracefully', () => {
    (globalThis as Record<string, unknown>).api = undefined;
    expect(() => render(<PopoutBoard {...defaultProps} />)).not.toThrow();
  });

  it('adds kiosk class to masonry grid in kiosk mode', () => {
    render(<PopoutBoard {...defaultProps} />);
    fireEvent.click(screen.getByText('KIOSK'));
    const grid = screen.getByLabelText('On-Call Teams');
    expect(grid.className).toContain('oncall-grid--kiosk');
  });
});
