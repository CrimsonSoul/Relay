import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamRow } from '../../personnel/TeamRow';
import type { OnCallRow } from '@shared/ipc';

// Mock useToast
vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: '1',
  team: 'Alpha',
  role: 'Primary',
  name: 'Bob Jones',
  contact: '5551234567',
  timeWindow: '',
  ...overrides,
});

describe('TeamRow', () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).api = {
      writeClipboard: vi.fn().mockResolvedValue(true),
    };
  });

  it('renders the role label', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'Primary' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    // getRoleLabel('Primary') → 'Primary'
    expect(screen.getAllByText('Primary').length).toBeGreaterThan(0);
  });

  it('renders the member name', () => {
    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} gridTemplate="auto 1fr auto" />);
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('renders empty name as dash', () => {
    render(
      <TeamRow row={makeRow({ name: '' })} hasAnyTimeWindow={false} gridTemplate="auto 1fr auto" />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders formatted phone number', () => {
    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} gridTemplate="auto 1fr auto" />);
    // formatPhoneNumber('5551234567') → '(555) 123-4567'
    expect(screen.getByText('(555) 123-4567')).toBeInTheDocument();
  });

  it('renders time window column when hasAnyTimeWindow is true', () => {
    render(
      <TeamRow
        row={makeRow({ timeWindow: '9-5' })}
        hasAnyTimeWindow={true}
        gridTemplate="auto 1fr auto 100px"
      />,
    );
    expect(screen.getByText('9-5')).toBeInTheDocument();
  });

  it('does not render time window column when hasAnyTimeWindow is false', () => {
    const { container } = render(
      <TeamRow
        row={makeRow({ timeWindow: '9-5' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(container.querySelector('.team-row-time-window')).toBeNull();
  });

  it('calls api.writeClipboard when phone button is clicked', async () => {
    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} gridTemplate="auto 1fr auto" />);
    fireEvent.click(screen.getByText('(555) 123-4567'));
    expect(
      (globalThis as unknown as { api: { writeClipboard: ReturnType<typeof vi.fn> } }).api
        .writeClipboard,
    ).toHaveBeenCalledWith('5551234567');
  });

  it('shows Member label for unknown role', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'member' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getAllByText('Member').length).toBeGreaterThan(0);
  });

  it('shows Secondary label for secondary role', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'Secondary' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getAllByText('Secondary').length).toBeGreaterThan(0);
  });
});
