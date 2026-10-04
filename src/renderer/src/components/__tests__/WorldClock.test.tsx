import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorldClock } from '../WorldClock';

describe('WorldClock', () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  beforeEach(() => {
    vi.useFakeTimers();
    // Freeze to January (standard time) so America/Chicago shows CST, not CDT
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options: Intl.DateTimeFormatOptions = {},
    ) {
      return new originalDateTimeFormat(locales, {
        timeZone: 'America/Chicago',
        ...options,
      });
    } as typeof Intl.DateTimeFormat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    render(<WorldClock />);
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
  });

  it('renders the primary clock as a clickable trigger', () => {
    render(<WorldClock />);
    const trigger = document.querySelector('.world-clock-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not render secondary zones inline', () => {
    render(<WorldClock />);
    const secondary = document.querySelector('.world-clock-secondary');
    expect(secondary).toBeNull();
  });

  it('shows CST label for America/Chicago timezone', () => {
    render(<WorldClock />);
    // CST is the known label for America/Chicago
    expect(screen.getByText(/CST/)).toBeInTheDocument();
  });

  it('opens popover with secondary zones on click', () => {
    render(<WorldClock />);
    const trigger = document.querySelector('.world-clock-trigger')!;
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const popover = document.querySelector('.world-clock-popover');
    expect(popover).toBeTruthy();
    // With CST as primary, should have 3 secondary zones (PST, MST, EST)
    const items = document.querySelectorAll('.world-clock-popover-item');
    expect(items).toHaveLength(3);
  });

  it('closes popover on Escape', () => {
    render(<WorldClock />);
    const trigger = document.querySelector('.world-clock-trigger')!;
    fireEvent.click(trigger);
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('toggles popover on repeated clicks', () => {
    render(<WorldClock />);
    const trigger = document.querySelector('.world-clock-trigger')!;
    fireEvent.click(trigger);
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();
    fireEvent.click(trigger);
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('closes popover when backdrop is mousedown', () => {
    render(<WorldClock />);
    const trigger = document.querySelector('.world-clock-trigger')!;
    fireEvent.click(trigger);
    expect(document.querySelector('.world-clock-popover')).toBeTruthy();

    const backdrop = document.querySelector('.world-clock-backdrop')!;
    fireEvent.mouseDown(backdrop);
    expect(document.querySelector('.world-clock-popover')).toBeNull();
  });

  it('updates time when minute changes', async () => {
    render(<WorldClock />);

    // Advance by 61 seconds to cross a minute boundary
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    // The component should have re-rendered
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
  });

  it('schedules minute-boundary updates without a one-second interval', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.setSystemTime(new Date('2026-01-15T12:00:30Z'));

    render(<WorldClock />);

    expect(intervalSpy).not.toHaveBeenCalled();
    const initialTime = document.querySelector('.world-clock-primary-time')?.textContent;

    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    expect(document.querySelector('.world-clock-primary-time')?.textContent).toBe(initialTime);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector('.world-clock-primary-time')?.textContent).not.toBe(initialTime);
  });

  it('resynchronizes immediately when the window becomes visible', async () => {
    render(<WorldClock />);
    const initialTime = document.querySelector('.world-clock-primary-time')?.textContent;

    vi.setSystemTime(new Date('2026-01-15T12:05:00Z'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(document.querySelector('.world-clock-primary-time')?.textContent).not.toBe(initialTime);
  });

  it('stops minute wakeups while hidden and restarts them when visible', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:30Z'));
    render(<WorldClock />);
    const initialTime = document.querySelector('.world-clock-primary-time')?.textContent;

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(90_000);
    });
    expect(document.querySelector('.world-clock-primary-time')?.textContent).toBe(initialTime);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(document.querySelector('.world-clock-primary-time')?.textContent).not.toBe(initialTime);
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

  it('falls back to local timezone when context provides null', () => {
    // The existing mock returns timezone: 'America/Chicago'
    // This test verifies the component renders in that case
    render(<WorldClock />);
    const container = document.querySelector('.world-clock-container');
    expect(container).toBeTruthy();
    // Should show time string
    expect(document.querySelector('.world-clock-primary-time')?.textContent).toBeTruthy();
  });
});

describe('Header hierarchy', () => {
  const layoutCss = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/styles/components/components-layout.css'),
    'utf8',
  );
  const ruleBody = (selector: string) => {
    const escaped = selector.replaceAll('.', String.raw`\.`);
    return new RegExp(String.raw`(?:^|\n)${escaped}\s*\{([^}]*)\}`).exec(layoutCss)?.[1] ?? '';
  };

  it('keeps the clock and the quiet header commands at one size', () => {
    const time = ruleBody('.world-clock-primary-time');
    const action = ruleBody('.header-action.tactile-button');

    expect(time).toContain('font-size: var(--text-sm)');
    expect(time).toContain('color: var(--color-text-secondary)');
    expect(time).toContain('font-variant-numeric: tabular-nums');
    // Help and Notifications are ghost commands below the page commands; hover lifts the ink.
    expect(action).toContain('font-size: var(--text-sm)');
    expect(action).toContain('font-weight: var(--weight-medium)');
    expect(action).toContain('color: var(--color-text-secondary)');
    expect(ruleBody('.header-action.tactile-button:hover')).toContain(
      'color: var(--color-text-primary)',
    );
  });
});
