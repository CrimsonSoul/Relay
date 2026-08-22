import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { WindowControls } from '../WindowControls';

describe('WindowControls', () => {
  beforeEach(() => {
    globalThis.api = {
      runtime: ELECTRON_RUNTIME,
      platform: 'win32',
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizeChange: vi.fn().mockReturnValue(vi.fn()),
      windowMinimize: vi.fn(),
      windowMaximize: vi.fn(),
      windowClose: vi.fn(),
    } as never;
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
    expect(globalThis.api?.windowMinimize).toHaveBeenCalled();
  });

  it('calls windowMaximize when Maximize is clicked', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('Maximize'));
    expect(globalThis.api?.windowMaximize).toHaveBeenCalled();
  });

  it('calls windowClose when Close is clicked', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(globalThis.api?.windowClose).toHaveBeenCalled();
  });

  it('returns null on darwin platform', () => {
    globalThis.api = { ...globalThis.api!, platform: 'darwin' };
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for the browser runtime', () => {
    globalThis.api = { ...globalThis.api!, runtime: WEB_RUNTIME };
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });
});
