import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { StartupErrorScreen } from '../StartupErrorScreen';

describe('StartupErrorScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.api = { runtime: ELECTRON_RUNTIME } as typeof globalThis.api;
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

  it('hides desktop connection recovery controls on the web', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as typeof globalThis.api;
    render(
      <StartupErrorScreen
        message="PocketBase authentication failed."
        retryable={false}
        onRetry={vi.fn()}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reconfigure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('stops auto-retrying after unmount', () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <StartupErrorScreen
        message="PocketBase server is unavailable."
        retryable={true}
        onRetry={onRetry}
        onReconfigure={vi.fn()}
      />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });
});
