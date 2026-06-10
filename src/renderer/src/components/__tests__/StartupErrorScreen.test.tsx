import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { StartupErrorScreen } from '../StartupErrorScreen';

describe('StartupErrorScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the message and calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    render(
      <StartupErrorScreen
        message="PocketBase server is unavailable."
        retryable={true}
        onRetry={onRetry}
        onReconfigure={vi.fn()}
      />,
    );
    expect(screen.getByText('PocketBase server is unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('auto-retries every 10 seconds while retryable', () => {
    const onRetry = vi.fn();
    render(
      <StartupErrorScreen
        message="Connection timed out. The server may be unreachable."
        retryable={true}
        onRetry={onRetry}
        onReconfigure={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not auto-retry or show Retry for non-retryable errors', () => {
    const onRetry = vi.fn();
    render(
      <StartupErrorScreen
        message="PocketBase authentication failed."
        retryable={false}
        onRetry={onRetry}
        onReconfigure={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('calls onReconfigure from the Reconfigure button', () => {
    const onReconfigure = vi.fn();
    render(
      <StartupErrorScreen
        message="PocketBase authentication failed."
        retryable={false}
        onRetry={vi.fn()}
        onReconfigure={onReconfigure}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconfigure' }));
    expect(onReconfigure).toHaveBeenCalledOnce();
  });
});
