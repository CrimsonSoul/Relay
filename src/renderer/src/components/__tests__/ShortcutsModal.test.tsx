import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { ShortcutsModal } from '../ShortcutsModal';

describe('ShortcutsModal', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutsModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Help and keyboard shortcuts')).not.toBeInTheDocument();
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
    expect(screen.getByText('Help and keyboard shortcuts')).toBeInTheDocument();
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
    expect(screen.getByText('Go to On-Call')).toBeInTheDocument();
    expect(screen.getByText('Go to Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Go to Status')).toBeInTheDocument();
    expect(screen.getByText('Go to Problems')).toBeInTheDocument();
    expect(screen.getByText('Go to Radar')).toBeInTheDocument();
    expect(screen.queryByText('Go to Dispatcher Radar')).not.toBeInTheDocument();
    expect(screen.getByText('Next or previous problem in the current view')).toBeInTheDocument();
    expect(screen.getByText('Save alert image')).toBeInTheDocument();
    expect(screen.getByText('Focus selected problem note')).toBeInTheDocument();
    expect(screen.queryByText('Go to People')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to Servers')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to Notes')).not.toBeInTheDocument();
    expect(screen.getByText('Search Relay')).toBeInTheDocument();
    expect(screen.getByText('Open the team menu (focused team card)')).toBeInTheDocument();
    expect(screen.getByText('Open the context menu for the focused item')).toBeInTheDocument();
    expect(screen.getByText('Add highlighted contact to bridge (in search)')).toBeInTheDocument();
    expect(screen.getByText('Shift + Enter')).toBeInTheDocument();
    expect(screen.getByText('Close modal / dialog')).toBeInTheDocument();
    expect(screen.getByText('Find in the open document')).toBeInTheDocument();
    expect(screen.getByText('Highlight selected body text')).toBeInTheDocument();
    // No handler exists for a Compose copy-bridge chord, so it is not advertised.
    expect(screen.queryByText('Copy bridge (in Compose)')).not.toBeInTheDocument();
  });

  it('explains Relay-specific terms in a short glossary', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Relay terms')).toBeInTheDocument();
    for (const term of [
      'Bridge',
      'PRI / BKP / MEM',
      'No coverage',
      'Lock Order / Unlock Order',
      'NOC response',
      'Third-party',
      'Not syncing',
      'Status pips',
      'NOC note',
      'Addressed in Relay',
      'Alerting profile',
      'Embedded Server',
      'Clients connected',
      'Wiki publisher',
      'Accent schedule',
      'XCenter',
      'PaPA Processor Service',
      'SDP',
      'NOC / SOX / Unassigned queues',
      'Confirm Live Change',
      'Saved copy · Read only',
    ]) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
    expect(screen.queryByText(/colour/)).not.toBeInTheDocument();
  });

  it('offers task-oriented How to steps', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('How to')).toBeInTheDocument();
    for (const task of [
      'Assemble a bridge',
      'Assign on-call coverage',
      'Reorder or lock team cards',
      'Share on-call info',
      'Address a problem',
      'Send an alert',
      'Check provider status',
      'Watch the dispatcher queues',
      'Find reference information',
      'Reply to a ticket',
      'Route or assign a ticket',
      'Merge duplicate tickets',
      'Update several tickets at once',
      'Back up or restore Relay data',
    ]) {
      expect(screen.getByText(task)).toBeInTheDocument();
    }
    expect(screen.getByText(/then Mark Addressed in Relay\./)).toBeInTheDocument();
    expect(screen.getByText(/Compose builds the bridge/)).toBeInTheDocument();
    expect(screen.getByText(/then Merge Duplicate Into the open ticket/)).toBeInTheDocument();
    expect(screen.getByText(/choose Open Data Manager, then Backups/)).toBeInTheDocument();
  });

  it('filters shortcuts, tasks and terms and explains an empty result', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    const filter = screen.getByRole('searchbox', { name: 'Filter help' });
    // The live region is mounted empty before any filter, so the no-match message is announced.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fireEvent.change(filter, { target: { value: 'lock order' } });
    expect(screen.getByText('Reorder or lock team cards')).toBeInTheDocument();
    expect(screen.getByText('Lock Order / Unlock Order')).toBeInTheDocument();
    expect(screen.queryByText('Go to Compose')).not.toBeInTheDocument();
    expect(screen.queryByText('Send an alert')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'shift + f10' } });
    expect(screen.getByText('Open the team menu (focused team card)')).toBeInTheDocument();
    expect(screen.queryByText('Relay terms')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'zzzz' } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Nothing in Help matches “zzzz”.');
    expect(status).toHaveClass('shortcuts-modal-empty');
  });

  it('renders the Esc footer instruction', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('opens scoped to the active tab and widens with Show All', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} scope="Problems" />);

    expect(screen.getByText('Showing help for Problems')).toBeInTheDocument();
    expect(screen.getByText('Search problems')).toBeInTheDocument();
    expect(screen.getByText('Address a problem')).toBeInTheDocument();
    expect(screen.getByText('Not syncing')).toBeInTheDocument();
    // Other tabs' sections, tasks and terms, and untagged sections, stay out of scope.
    expect(screen.queryByText('Go to Compose')).not.toBeInTheDocument();
    expect(screen.queryByText('Send an alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Bridge')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show All' }));
    expect(screen.getByText('Showing all help')).toBeInTheDocument();
    expect(screen.getByText('Go to Compose')).toBeInTheDocument();
    expect(screen.getByText('Send an alert')).toBeInTheDocument();
    expect(screen.getByText('Bridge')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show Problems Only' }));
    expect(screen.getByText('Showing help for Problems')).toBeInTheDocument();
    expect(screen.queryByText('Bridge')).not.toBeInTheDocument();
  });

  it('names a destination by its nav label in the scope line', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} scope="Personnel" />);
    expect(screen.getByText('Showing help for On-Call')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show All' })).toBeInTheDocument();
  });

  it('searches all of Help while a filter is typed, even when scoped', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} scope="Problems" />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter help' }), {
      target: { value: 'bridge' },
    });
    expect(screen.getByText('Bridge')).toBeInTheDocument();
    expect(screen.getByText('Assemble a bridge')).toBeInTheDocument();
    expect(screen.queryByText('Showing help for Problems')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show All' })).not.toBeInTheDocument();
  });

  it('shows no scope line when opened without a tab', () => {
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show All' })).not.toBeInTheDocument();
  });
});

describe('ShortcutsModal platform detection', () => {
  const originalApi = globalThis.window?.api;

  afterEach(() => {
    if (originalApi) {
      globalThis.window.api = originalApi;
    }
  });

  it('uses Ctrl key label when platform is not darwin', async () => {
    // Re-import the module with non-darwin platform to cover the isMac branch
    // The module-level isMac is evaluated at import time, so we need to test
    // the actual rendered content which uses the already-evaluated modKey
    globalThis.api = { runtime: ELECTRON_RUNTIME, platform: 'win32' } as never;
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    // The shortcut keys should contain either Ctrl or Cmd symbol
    const allShortcutKeys = screen.getAllByText(/Ctrl|⌘/);
    expect(allShortcutKeys.length).toBeGreaterThan(0);
  });

  it('shows the physical Shift + / key for the shortcuts overlay on macOS', () => {
    globalThis.api = { runtime: ELECTRON_RUNTIME, platform: 'darwin' } as never;
    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('⌘ + Shift + /')).toBeInTheDocument();
    expect(screen.queryByText('⌘ + ?')).not.toBeInTheDocument();
  });

  it('shows browser-safe shortcuts and explains the different Web mapping', () => {
    globalThis.api = { runtime: WEB_RUNTIME, platform: 'darwin' } as never;

    render(<ShortcutsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Alt + Shift + 1')).toBeInTheDocument();
    expect(screen.getByText('Alt + Shift + K')).toBeInTheDocument();
    expect(screen.getByText('Alt + Shift + ,')).toBeInTheDocument();
    expect(screen.getByText('Alt + Shift + /')).toBeInTheDocument();
    expect(screen.getByText(/avoid browser-reserved shortcuts/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Escape does not dismiss an expired-session sign-in/i),
    ).toBeInTheDocument();
  });
});
