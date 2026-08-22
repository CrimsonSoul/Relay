import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamRow } from '../TeamRow';
import type { OnCallRow } from '@shared/ipc';

const showToast = vi.fn();

vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

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

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to copy', 'error'));
  });

  it('reports a missing clipboard bridge in the Web runtime', async () => {
    vi.stubGlobal('api', undefined);

    render(<TeamRow row={makeRow()} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy contact/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to copy', 'error'));
  });

  it('does not touch the clipboard for a row with no contact', () => {
    const writeClipboard = vi.fn();
    vi.stubGlobal('api', { writeClipboard });

    render(<TeamRow row={makeRow({ contact: '' })} hasAnyTimeWindow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'No contact available' }));

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
