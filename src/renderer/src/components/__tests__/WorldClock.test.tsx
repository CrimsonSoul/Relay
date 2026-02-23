import React from 'react';
import { render, screen, act } from '@testing-library/react';
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

  it('renders a primary time zone', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const primary = document.querySelector('.world-clock-primary');
    expect(primary).toBeTruthy();
  });

  it('renders secondary time zones', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const secondary = document.querySelector('.world-clock-secondary');
    expect(secondary).toBeTruthy();
  });

  it('shows CST label for America/Chicago timezone', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    // CST is the known label for America/Chicago
    expect(screen.getByText(/CST/)).toBeInTheDocument();
  });

  it('renders secondary zones that exclude the primary timezone', async () => {
    await act(async () => {
      render(<WorldClock />);
    });
    const items = document.querySelectorAll('.world-clock-item');
    // With CST as primary, should have 3 secondary zones (PST, MST, EST)
    expect(items.length).toBe(3);
  });
});
