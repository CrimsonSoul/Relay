import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleBridgeModal } from '../ScheduleBridgeModal';
import { getOrganizerEmail } from '../../../utils/organizerEmail';

// Mock Modal to avoid portal issues in jsdom
vi.mock('../../../components/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen
      ? React.createElement('div', { 'data-testid': 'modal' }, [
          React.createElement('h2', { key: 'title' }, title),
          React.createElement('div', { key: 'body' }, children),
        ])
      : null,
}));

// Mock useToast so toast calls can be asserted
const mockShowToast = vi.fn();
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockSaveAndOpenIcs = vi.fn();

describe('ScheduleBridgeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    attendees: [{ name: 'Alice Adams', email: 'alice@test.com' }, { email: 'bob@test.com' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers({ now: new Date(2026, 5, 12, 10, 12, 0), toFake: ['Date'] });
    (globalThis as Window & { api?: unknown }).api = {
      saveAndOpenIcs: mockSaveAndOpenIcs,
    } as unknown as typeof globalThis.api;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title and fields with defaults', () => {
    localStorage.setItem('relay-organizer-email', 'me@test.com');
    render(<ScheduleBridgeModal {...defaultProps} />);

    expect(screen.getByText('Schedule Bridge')).toBeInTheDocument();
    // Next half-hour boundary after 10:12 is 10:30 local time
    expect(screen.getByLabelText(/date & time/i)).toHaveValue('2026-06-12T10:30');
    expect(screen.getByLabelText(/duration/i)).toHaveValue('60');
    expect(screen.getByLabelText(/subject/i)).toHaveValue('6/12 – Bridge');
    expect(screen.getByLabelText(/your email/i)).toHaveValue('me@test.com');
  });

  it('does not render when closed', () => {
    render(<ScheduleBridgeModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Schedule Bridge')).not.toBeInTheDocument();
  });

  it('shows an inline error for an invalid organizer email and does not create an invite', () => {
    render(<ScheduleBridgeModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByText('Create Invite'));

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(mockSaveAndOpenIcs).not.toHaveBeenCalled();
  });

  it('creates the invite with all attendees, persists the organizer email, and closes', async () => {
    mockSaveAndOpenIcs.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<ScheduleBridgeModal {...defaultProps} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'me@test.com' } });
    fireEvent.click(screen.getByText('Create Invite'));

    await waitFor(() => expect(mockSaveAndOpenIcs).toHaveBeenCalledTimes(1));
    // Unfold RFC 5545 folded lines before asserting on content
    const ics = (mockSaveAndOpenIcs.mock.calls[0][0] as string).replaceAll('\r\n ', '');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('mailto:alice@test.com');
    expect(ics).toContain('mailto:bob@test.com');
    expect(ics).toContain('CN=Alice Adams');
    expect(ics).toContain('ORGANIZER;CN=me@test.com:mailto:me@test.com');

    expect(getOrganizerEmail()).toBe('me@test.com');
    expect(mockShowToast).toHaveBeenCalledWith(
      'Invite created — review and send in your calendar',
      'success',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error toast when saving the invite fails', async () => {
    mockSaveAndOpenIcs.mockResolvedValue(false);
    render(<ScheduleBridgeModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'me@test.com' } });
    fireEvent.click(screen.getByText('Create Invite'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Failed to create invite', 'error'),
    );
  });
});
