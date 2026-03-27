import { render, screen } from '@testing-library/react';
import { EventTimeBanner } from '../alerts/EventTimeBanner';

describe('EventTimeBanner', () => {
  it('renders nothing when no event time is provided', () => {
    const { container } = render(<EventTimeBanner severity="MAINTENANCE" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Scheduled" label for MAINTENANCE severity', () => {
    render(<EventTimeBanner severity="MAINTENANCE" startTime="2026-04-05T07:00:00Z" />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
  });

  it('renders "Started" label for ISSUE severity', () => {
    render(<EventTimeBanner severity="ISSUE" startTime="2026-03-25T19:15:00Z" />);
    expect(screen.getByText('Started')).toBeTruthy();
  });

  it('renders "When" label for INFO severity', () => {
    render(<EventTimeBanner severity="INFO" startTime="2026-04-01T14:00:00Z" />);
    expect(screen.getByText('When')).toBeTruthy();
  });

  it('renders "Duration" label for RESOLVED severity', () => {
    render(<EventTimeBanner severity="RESOLVED" startTime="2026-03-25T16:00:00Z" />);
    expect(screen.getByText('Duration')).toBeTruthy();
  });

  it('shows start and end time range when both provided', () => {
    render(
      <EventTimeBanner
        severity="MAINTENANCE"
        startTime="2026-04-05T07:00:00Z"
        endTime="2026-04-05T11:00:00Z"
      />,
    );
    expect(screen.getByText(/2:00\s*AM/)).toBeTruthy();
    expect(screen.getByText(/6:00\s*AM/)).toBeTruthy();
  });

  it('shows only start time when no end time', () => {
    render(<EventTimeBanner severity="ISSUE" startTime="2026-03-25T19:15:00Z" />);
    expect(screen.getByText(/2:15\s*PM/)).toBeTruthy();
  });
});
