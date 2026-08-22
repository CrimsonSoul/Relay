import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@shared/ipc';
import { BridgeHandoffModal } from '../BridgeHandoffModal';
import type { BridgeHandoffRecipient } from '../bridgeHandoff';

vi.mock('../../../components/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
    dismissible,
  }: {
    isOpen: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    footer: React.ReactNode;
    dismissible?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" data-dismissible={String(dismissible)}>
        <h2>{title}</h2>
        <div>{children}</div>
        <footer>{footer}</footer>
      </div>
    ) : null,
}));

const recipients: BridgeHandoffRecipient[] = [
  {
    email: 'alice@example.com',
    normalizedEmail: 'alice@example.com',
    source: 'group',
    valid: true,
  },
  {
    email: 'broken-address',
    normalizedEmail: 'broken-address',
    source: 'manual',
    valid: false,
  },
];

const contactMap = new Map<string, Contact>([
  [
    'alice@example.com',
    {
      name: 'Alice Adams',
      email: 'alice@example.com',
      phone: '',
      title: 'Engineer',
      _searchString: 'alice adams alice@example.com engineer',
      raw: {},
    },
  ],
]);

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  subject: '8/4 -',
  recipients: recipients.slice(0, 1),
  duplicateCount: 0,
  manualCount: 0,
  groupNames: ['Network Operations'],
  contactMap,
  isCopying: false,
  isOpeningTeams: false,
  onCopy: vi.fn(),
  onOpenTeams: vi.fn(),
  onRemoveRecipient: vi.fn(),
};

describe('BridgeHandoffModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the prominent recording reminder and truthful handoff copy', () => {
    render(<BridgeHandoffModal {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Open Teams meeting draft?' })).toBeInTheDocument();
    expect(screen.getByText('Enable recording in Teams')).toBeInTheDocument();
    expect(screen.getByText(/Relay cannot enable or verify it/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('8/4 -')).toBeInTheDocument();
    expect(screen.getByText('Network Operations')).toBeInTheDocument();
  });

  it('blocks handoff actions and exposes removal when an address is invalid', () => {
    const onRemoveRecipient = vi.fn();
    render(
      <BridgeHandoffModal
        {...defaultProps}
        recipients={recipients}
        onRemoveRecipient={onRemoveRecipient}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open Teams Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Recipients' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove broken-address' }));
    expect(onRemoveRecipient).toHaveBeenCalledWith('broken-address');
  });

  it('keeps the review open when copying and calls the correct callbacks', () => {
    const onCopy = vi.fn();
    const onOpenTeams = vi.fn();
    render(<BridgeHandoffModal {...defaultProps} onCopy={onCopy} onOpenTeams={onOpenTeams} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Recipients' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Teams Draft' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onOpenTeams).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('disables dismissal and all actions while either handoff is pending', () => {
    render(<BridgeHandoffModal {...defaultProps} isOpeningTeams />);

    expect(screen.getByRole('button', { name: 'Open Teams Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Recipients' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dismissible', 'false');
  });
});
