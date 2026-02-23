import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WeatherAlertCard } from '../WeatherAlertCard';
import type { WeatherAlert } from '../types';

// Mock Tooltip
vi.mock('../../../components/Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactElement; content: string }) =>
    React.createElement('div', { 'data-testid': 'tooltip', 'data-content': content }, children),
}));

const makeAlert = (overrides: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'alert-1',
  event: 'Tornado Warning',
  headline: 'Tornado Warning in effect until 6 PM',
  description: 'A tornado has been sighted near the area. Take shelter immediately.',
  severity: 'Extreme',
  urgency: 'Immediate',
  certainty: 'Observed',
  effective: '2026-02-22T12:00:00Z',
  expires: '2026-02-22T18:00:00Z',
  senderName: 'NWS Oklahoma City',
  areaDesc: 'Central Oklahoma',
  ...overrides,
});

describe('WeatherAlertCard', () => {
  it('renders the alert event name', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Tornado Warning')).toBeInTheDocument();
  });

  it('renders the alert headline', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Tornado Warning in effect until 6 PM')).toBeInTheDocument();
  });

  it('shows severity badge text for non-Unknown severity', () => {
    render(
      <WeatherAlertCard
        alert={makeAlert({ severity: 'Severe' })}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Severe')).toBeInTheDocument();
  });

  it('shows "Outlook" badge for Unknown severity with "outlook" in event name', () => {
    const alert = makeAlert({
      severity: 'Unknown',
      event: 'Severe Thunderstorm Outlook',
    });
    render(<WeatherAlertCard alert={alert} isExpanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Outlook')).toBeInTheDocument();
  });

  it('shows "Advisory" badge for Unknown severity without "outlook" in event name', () => {
    const alert = makeAlert({
      severity: 'Unknown',
      event: 'Heat Advisory',
    });
    render(<WeatherAlertCard alert={alert} isExpanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Advisory')).toBeInTheDocument();
  });

  it('shows Immediate urgency badge when urgency is Immediate', () => {
    render(
      <WeatherAlertCard
        alert={makeAlert({ urgency: 'Immediate' })}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('🚨 Immediate')).toBeInTheDocument();
  });

  it('does not show Immediate urgency badge for non-Immediate urgency', () => {
    render(
      <WeatherAlertCard
        alert={makeAlert({ urgency: 'Expected' })}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByText('🚨 Immediate')).not.toBeInTheDocument();
  });

  it('calls onToggle when the card button is clicked', () => {
    const onToggle = vi.fn();
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Weather alert: Tornado Warning/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('sets aria-expanded to false when not expanded', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Weather alert: Tornado Warning/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('sets aria-expanded to true when expanded', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={true} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Weather alert: Tornado Warning/i });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows description and sender info when expanded', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={true} onToggle={vi.fn()} />);
    expect(
      screen.getByText('A tornado has been sighted near the area. Take shelter immediately.'),
    ).toBeInTheDocument();
    expect(screen.getByText('NWS Oklahoma City')).toBeInTheDocument();
  });

  it('applies expand class when expanded', () => {
    const { container } = render(
      <WeatherAlertCard alert={makeAlert()} isExpanded={true} onToggle={vi.fn()} />,
    );
    const expandEl = container.querySelector('.weather-alert-expand--open');
    expect(expandEl).not.toBeNull();
  });

  it('does not apply expand class when not expanded', () => {
    const { container } = render(
      <WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={vi.fn()} />,
    );
    const expandEl = container.querySelector('.weather-alert-expand--open');
    expect(expandEl).toBeNull();
  });

  it('shows tooltip with "Click to collapse" when expanded', () => {
    const { container } = render(
      <WeatherAlertCard alert={makeAlert()} isExpanded={true} onToggle={vi.fn()} />,
    );
    const tooltip = container.querySelector('[data-testid="tooltip"]');
    expect(tooltip?.getAttribute('data-content')).toBe('Click to collapse');
  });

  it('shows tooltip with "Click to view full alert details" when not expanded', () => {
    const { container } = render(
      <WeatherAlertCard alert={makeAlert()} isExpanded={false} onToggle={vi.fn()} />,
    );
    const tooltip = container.querySelector('[data-testid="tooltip"]');
    expect(tooltip?.getAttribute('data-content')).toBe('Click to view full alert details');
  });

  it('renders with Moderate severity colors', () => {
    // Should not throw, uses fallback colors from SEVERITY_COLORS
    render(
      <WeatherAlertCard
        alert={makeAlert({ severity: 'Moderate' })}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('renders with Minor severity', () => {
    render(
      <WeatherAlertCard
        alert={makeAlert({ severity: 'Minor' })}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Minor')).toBeInTheDocument();
  });

  it('renders the expires date', () => {
    render(<WeatherAlertCard alert={makeAlert()} isExpanded={true} onToggle={vi.fn()} />);
    // The expires date should be rendered somewhere
    const expiresText = screen.getByText(/Expires:/);
    expect(expiresText).toBeInTheDocument();
  });
});
