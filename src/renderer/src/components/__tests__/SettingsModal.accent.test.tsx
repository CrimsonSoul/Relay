import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from '../SettingsModal';

// Mock Modal to a simple wrapper (same as SettingsModal.test.tsx)
vi.mock('../Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen
      ? React.createElement(
          'div',
          { role: 'dialog' },
          title && React.createElement('h2', null, title),
          children,
        )
      : null,
}));

// Mock TactileButton (same as SettingsModal.test.tsx)
vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    disabled,
    block: _b,
    className: _c,
    variant: _v,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    block?: boolean;
    className?: string;
    variant?: string;
  }) => React.createElement('button', { onClick, disabled }, children),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe('SettingsModal — accent color picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear stored accent so tests start from default
    localStorage.removeItem('relay-accent');
    // Reset data-accent attribute
    document.documentElement.removeAttribute('data-accent');
    // Set up globalThis.api (required by the component's useEffect)
    const mockApi = {
      getConfig: vi.fn().mockResolvedValue({ mode: 'server', port: 8090 }),
      clearConfig: vi.fn().mockResolvedValue(true),
    };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;
  });

  afterEach(() => {
    localStorage.removeItem('relay-accent');
    document.documentElement.removeAttribute('data-accent');
  });

  it('renders five radio buttons for the accent picker', () => {
    render(<SettingsModal {...defaultProps} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
  });

  it('clicking "Purple" sets data-accent="purple" on documentElement', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByTitle('Purple');
    fireEvent.click(purpleButton);
    expect(document.documentElement.getAttribute('data-accent')).toBe('purple');
  });

  it('clicking "Purple" persists relay-accent="purple" in localStorage', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByTitle('Purple');
    fireEvent.click(purpleButton);
    expect(localStorage.getItem('relay-accent')).toBe('purple');
  });

  it('moves aria-checked to the selected swatch after clicking "Purple"', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByTitle('Purple');

    // Before clicking, purple should not be checked
    expect(purpleButton).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(purpleButton);

    // After clicking, purple should be checked
    expect(purpleButton).toHaveAttribute('aria-checked', 'true');

    // Previously active swatch (default red) should now be unchecked
    const redButton = screen.getByTitle('Signal Red');
    expect(redButton).toHaveAttribute('aria-checked', 'false');
  });
});
