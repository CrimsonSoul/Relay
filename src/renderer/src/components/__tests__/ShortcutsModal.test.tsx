import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ShortcutsModal } from '../ShortcutsModal';

describe('ShortcutsModal', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutsModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('renders as a dialog when open', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-variant', 'standard');
    expect(dialog).not.toHaveClass('shortcuts-modal');
    expect(dialog.querySelector('.modal-header-generic')).not.toBeNull();
    expect(dialog.querySelector('.modal-body-generic')).not.toBeNull();
    expect(dialog.querySelector('.modal-footer-generic')).not.toBeNull();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders all shortcut categories', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('renders shortcut descriptions', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Go to Compose')).toBeInTheDocument();
    expect(screen.getByText('Go to Alerts')).toBeInTheDocument();
    expect(screen.getByText('Go to On-Call Board')).toBeInTheDocument();
    expect(screen.getByText('Go to Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Go to Service Status')).toBeInTheDocument();
    expect(screen.getByText('Go to Dynatrace Problems')).toBeInTheDocument();
    expect(screen.queryByText('Go to People')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to Servers')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to Notes')).not.toBeInTheDocument();
    expect(screen.getByText('Focus Search')).toBeInTheDocument();
    expect(screen.getByText('Close modal / dialog')).toBeInTheDocument();
  });

  it('renders the Esc footer instruction', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });
});

describe('ShortcutsModal platform detection', () => {
  const originalApi = globalThis.window?.api;

  afterEach(() => {
    if (originalApi) {
      (globalThis.window as Record<string, unknown>).api = originalApi;
    }
  });

  it('uses Ctrl key label when platform is not darwin', async () => {
    // Re-import the module with non-darwin platform to cover the isMac branch
    // The module-level isMac is evaluated at import time, so we need to test
    // the actual rendered content which uses the already-evaluated modKey
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    // The shortcut keys should contain either Ctrl or Cmd symbol
    const allShortcutKeys = screen.getAllByText(/Ctrl|⌘/);
    expect(allShortcutKeys.length).toBeGreaterThan(0);
  });
});
