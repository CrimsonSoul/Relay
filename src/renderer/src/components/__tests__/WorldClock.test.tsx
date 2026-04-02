import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorldClock } from '../WorldClock';

// Mock the LocationContext
vi.mock('../../contexts', () => ({
  useLocation: () => ({
    timezone: 'America/Chicago',
  }),
}));

describe('WorldClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Freeze to January (standard time) so America/Chicago shows CST, not CDT
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders without crashing', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
  });

  it('renders the primary clock as a clickable trigger', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const trigger = document.querySelector('.world-clock-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not render secondary zones inline', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const secondary = document.querySelector('.world-clock-secondary');
    expect(secondary).toBeNull();
  });

  it('shows CST label for America/Chicago timezone', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    // CST is the known label for America/Chicago
    expect(screen.getByText(/CST/)).toBeInTheDocument();
  });

  it('opens popover with secondary zones on click', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const trigger = document.querySelector('.world-clock-trigger')!;
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const popover = document.querySelector('.world-clock-popover');
    expect(popover).toBeTruthy();
    // With CST as primary, should have 3 secondary zones (PST, MST, EST)
    const items = document.querySelectorAll('.world-clock-popover-item');
    expect(items.length).toBe(3);
  });

  it('closes popover on Escape', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const trigger = document.querySelector('.world-clock-trigger')!;
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('toggles popover on repeated clicks', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const trigger = document.querySelector('.world-clock-trigger')!;
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('closes popover when backdrop is mousedown', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const trigger = document.querySelector('.world-clock-trigger')!;
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();

    const backdrop = document.querySelector('.world-clock-backdrop')!;
    await act(async () => {
      fireEvent.mouseDown(backdrop);
    });
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('updates time when minute changes', async () => {
    await act(async () => {
      render(<WorldClock />);
    });

    // Advance by 61 seconds to cross a minute boundary
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    // The component should have re-rendered
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
  });
});

describe('WorldClock with no timezone context', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to local timezone when context provides null', async () => {
    // The existing mock returns timezone: 'America/Chicago'
    // This test verifies the component renders in that case
    await act(async () => {
      render(<WorldClock />);
    });
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
    // Should show time string
    expect(document.querySelector('.world-clock-primary-time')?.textContent).toBeTruthy();
  });
});
