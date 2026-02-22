import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowControls } from '../WindowControls';

describe('WindowControls', () => {
  beforeEach(() => {
    // Mock window.api without platform so we get the full controls (non-darwin)
    (globalThis as unknown as Record<string, unknown>).window = {
      api: {
        isMaximized: vi.fn().mockResolvedValue(false),
        onMaximizeChange: vi.fn().mockReturnValue(vi.fn()),
        windowMinimize: vi.fn(),
        windowMaximize: vi.fn(),
        windowClose: vi.fn(),
        // No 'platform' key → not darwin → renders controls
      },
    };
  });

  it('renders minimize, maximize, and close buttons', () => {
    render(<WindowControls />);
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument();
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('calls windowMinimize when Minimize is clicked', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('Minimize'));
    expect(
      (globalThis as unknown as { window: { api: { windowMinimize: ReturnType<typeof vi.fn> } } })
        .window.api.windowMinimize,
    ).toHaveBeenCalled();
  });

  it('calls windowMaximize when Maximize is clicked', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('Maximize'));
    expect(
      (globalThis as unknown as { window: { api: { windowMaximize: ReturnType<typeof vi.fn> } } })
        .window.api.windowMaximize,
    ).toHaveBeenCalled();
  });

  it('calls windowClose when Close is clicked', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(
      (globalThis as unknown as { window: { api: { windowClose: ReturnType<typeof vi.fn> } } })
        .window.api.windowClose,
    ).toHaveBeenCalled();
  });

  it('returns null on darwin platform', () => {
    (globalThis as unknown as Record<string, unknown>).window = {
      api: {
        isMaximized: vi.fn().mockResolvedValue(false),
        onMaximizeChange: vi.fn().mockReturnValue(vi.fn()),
        windowMinimize: vi.fn(),
        windowMaximize: vi.fn(),
        windowClose: vi.fn(),
        platform: 'darwin',
      },
    };
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });
});
