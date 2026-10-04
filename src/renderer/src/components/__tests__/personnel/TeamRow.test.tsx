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
  teamId: 'alpha',
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

  it('says the full role once: the word for wide rows, the code only for narrow ones', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'Primary' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByRole('img', { name: 'Primary role' })).toHaveTextContent('PRI');
    expect(screen.getByText('Primary')).toHaveClass('team-row-role-word');
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

  it('marks active time windows with an Active now pill', () => {
    render(
      <TeamRow
        row={makeRow({ timeWindow: 'always' })}
        hasAnyTimeWindow={true}
        gridTemplate="auto 1fr auto 100px"
      />,
    );

    expect(screen.getByText('Active now')).toBeInTheDocument();
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

  it('copies contact when phone is activated from keyboard', () => {
    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} gridTemplate="auto 1fr auto" />);
    const phone = screen.getByText('(555) 123-4567');

    fireEvent.keyDown(phone, { key: 'Enter' });

    expect(
      (globalThis as unknown as { api: { writeClipboard: ReturnType<typeof vi.fn> } }).api
        .writeClipboard,
    ).toHaveBeenCalledWith('5551234567');
  });

  it('names a plain member with the word, keeping MEM for narrow rows', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'member' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByText('MEM')).toBeInTheDocument();
    expect(screen.getByText('Member')).toHaveClass('team-row-role-word');
  });

  it('shows the full role word after the name, with the BKP code reserved for narrow rows', () => {
    const { container } = render(
      <TeamRow
        row={makeRow({ name: 'Grace Hopper', role: 'Secondary' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByRole('img', { name: 'Secondary role' })).toHaveTextContent('BKP');
    const roleWord = container.querySelector('.team-row-role-word');
    expect(roleWord).toHaveTextContent('· Secondary');
    expect(roleWord).not.toHaveAttribute('aria-hidden');
    expect(roleWord?.querySelector('.team-row-role-word-separator')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // Reads "Grace Hopper · Secondary": the word follows the name.
    expect(
      screen.getByText('Grace Hopper').compareDocumentPosition(roleWord as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('tells Standby and Escalation apart on the board without hovering', () => {
    const { rerender } = render(
      <TeamRow
        row={makeRow({ role: 'Standby' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByText('Standby')).toHaveClass('team-row-role-word');
    rerender(
      <TeamRow
        row={makeRow({ role: 'Escalation' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByText('Escalation')).toHaveClass('team-row-role-word');
  });

  it('shows plain Backup as a word too, so every wide row reads the same way', () => {
    const { container } = render(
      <TeamRow
        row={makeRow({ role: 'Backup' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByText('BKP')).toBeInTheDocument();
    expect(container.querySelector('.team-row-role-word')).toHaveTextContent('Backup');
  });

  it('uses a backup row treatment for backup/weekend coverage', () => {
    const { container } = render(
      <TeamRow
        row={makeRow({ role: 'Backup/Weekend' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );

    expect(container.querySelector('.team-row')).toHaveClass('team-row--backup');
    expect(screen.getByText('BKP')).toBeInTheDocument();
  });

  it('shows a custom role word after the name under the MEM code', () => {
    render(
      <TeamRow
        row={makeRow({ role: 'Incident Commander' })}
        hasAnyTimeWindow={false}
        gridTemplate="auto 1fr auto"
      />,
    );
    expect(screen.getByText('MEM')).toBeInTheDocument();
    expect(screen.getByText('Incident Commander')).toHaveClass('team-row-role-word');
  });
});
