import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamRow } from '../TeamRow';
import type { OnCallRow } from '@shared/ipc';

const showToast = vi.fn();

vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactElement; content: React.ReactNode }) => (
    <span data-tooltip={typeof content === 'string' ? content : undefined}>{children}</span>
  ),
}));

const COPY_FAILED =
  "Couldn't copy 5551234567. Clipboard access was blocked. Nothing was copied. Dial it from the board, or allow clipboard access and try again.";

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'r1',
  team: 'Alpha',
  teamId: 'alpha',
  role: 'Primary',
  name: 'Alice',
  contact: '5551234567',
  ...overrides,
});

describe('TeamRow contact copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms a successful clipboard write', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('api', { writeClipboard });

    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy contact/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied 5551234567', 'success'));
  });

  it('reports a rejected clipboard write instead of failing silently', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('api', { writeClipboard });

    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy contact/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(COPY_FAILED, 'error'));
  });

  it('reports a missing clipboard bridge in the Web runtime', async () => {
    vi.stubGlobal('api', undefined);

    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy contact/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(COPY_FAILED, 'error'));
  });

  it('does not touch the clipboard for a row with no contact', () => {
    const writeClipboard = vi.fn();
    vi.stubGlobal('api', { writeClipboard });

    render(<TeamRow row={makeRow({ contact: '' })} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'No contact available' }));

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows and copies a directory number, marked as coming from Contacts', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('api', { writeClipboard });

    render(
      <TeamRow row={makeRow({ contact: '' })} directoryPhone="5550100" hasAnyTimeWindow={false} />,
    );
    expect(screen.getByText('from Contacts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy contact 5550100 (from Contacts)' }));

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('5550100'));
  });

  it('prefers the saved number over a directory number', () => {
    render(<TeamRow row={makeRow()} directoryPhone="5550100" hasAnyTimeWindow={false} />);
    expect(screen.queryByText('from Contacts')).not.toBeInTheDocument();
  });
});

describe('TeamRow role code', () => {
  it.each([
    ['Primary', 'PRI', 'Primary'],
    ['Standby', 'BKP', 'Standby'],
    ['Secondary', 'BKP', 'Secondary'],
    ['Backup', 'BKP', 'Backup'],
    ['Escalation', 'BKP', 'Escalation'],
    ['Member', 'MEM', 'Member'],
    ['Shadow', 'MEM', 'Shadow'],
  ])('maps %s to %s and exposes the full role', (role, code, label) => {
    render(<TeamRow row={makeRow({ role })} hasAnyTimeWindow={false} />);
    const chip = screen.getByRole('img', { name: `${label} role` });
    expect(chip).toHaveTextContent(code);
    // Not a tab stop: the row's phone button is its keyboard target.
    expect(chip).not.toHaveAttribute('tabindex');
    expect(chip.parentElement).toHaveAttribute('data-tooltip', `${label} (${code})`);
  });
});

describe('TeamRow name focus', () => {
  const widthProps = ['scrollWidth', 'clientWidth'] as const;
  afterEach(() => {
    for (const prop of widthProps) Reflect.deleteProperty(HTMLElement.prototype, prop);
  });

  it('is not a tab stop when the name fits', () => {
    render(<TeamRow row={makeRow({ name: 'Alice' })} hasAnyTimeWindow={false} />);
    expect(screen.getByText('Alice')).not.toHaveAttribute('tabindex');
  });

  it('becomes a tab stop only while the name ellipsizes', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 100,
    });
    render(
      <TeamRow row={makeRow({ name: 'Bartholomew-Featherstonehaugh' })} hasAnyTimeWindow={false} />,
    );
    expect(screen.getByText('Bartholomew-Featherstonehaugh')).toHaveAttribute('tabindex', '0');
  });
});
