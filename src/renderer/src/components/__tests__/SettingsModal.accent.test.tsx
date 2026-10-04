import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
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
    ...buttonProps
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    block?: boolean;
    className?: string;
    variant?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', { onClick, disabled, ...buttonProps }, children),
}));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: () => ({
    session: { state: 'signed-out', role: null },
  }),
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
    localStorage.removeItem('relay-custom-accent');
    localStorage.removeItem('relay-custom-accents');
    localStorage.removeItem('relay-accent-schedule');
    // Reset data-accent attribute
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-hover');
    document.documentElement.style.removeProperty('--accent-bright');
    document.documentElement.style.removeProperty('--on-accent');
    // Set up globalThis.api (required by the component's useEffect)
    const mockApi: Partial<BridgeAPI> = {
      getConfig: vi.fn().mockResolvedValue({ mode: 'server', port: 8090 }),
      clearConfig: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('api', mockApi);
  });

  afterEach(() => {
    localStorage.removeItem('relay-accent');
    localStorage.removeItem('relay-custom-accent');
    localStorage.removeItem('relay-custom-accents');
    localStorage.removeItem('relay-accent-schedule');
    vi.useRealTimers();
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-hover');
    document.documentElement.style.removeProperty('--accent-bright');
    document.documentElement.style.removeProperty('--on-accent');
  });

  it('renders radio buttons for every accent picker option', () => {
    render(<SettingsModal {...defaultProps} />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Accent color' })).getAllByRole(
      'radio',
    );
    expect(radios).toHaveLength(10);
    expect(screen.getByRole('radio', { name: 'Yellow' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cyan' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Lime' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Violet' })).toBeInTheDocument();
  });

  it('clicking "Purple" sets data-accent="purple" on documentElement', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByRole('radio', { name: 'Purple' });
    fireEvent.click(purpleButton);
    expect(document.documentElement.getAttribute('data-accent')).toBe('purple');
  });

  it('clicking "Purple" persists relay-accent="purple" in localStorage', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByRole('radio', { name: 'Purple' });
    fireEvent.click(purpleButton);
    expect(localStorage.getItem('relay-accent')).toBe('purple');
  });

  it('clicking "Yellow" applies and persists the yellow accent', () => {
    render(<SettingsModal {...defaultProps} />);
    const yellowButton = screen.getByRole('radio', { name: 'Yellow' });

    fireEvent.click(yellowButton);

    expect(document.documentElement.getAttribute('data-accent')).toBe('yellow');
    expect(localStorage.getItem('relay-accent')).toBe('yellow');
    expect(yellowButton).toHaveAttribute('aria-checked', 'true');
  });

  it('moves aria-checked to the selected swatch after clicking "Purple"', () => {
    render(<SettingsModal {...defaultProps} />);
    const purpleButton = screen.getByRole('radio', { name: 'Purple' });

    // Before clicking, purple should not be checked
    expect(purpleButton).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(purpleButton);

    // After clicking, purple should be checked
    expect(purpleButton).toHaveAttribute('aria-checked', 'true');

    // Previously active swatch (default red) should now be unchecked
    const redButton = screen.getByRole('radio', { name: 'Signal Red' });
    expect(redButton).toHaveAttribute('aria-checked', 'false');
  });

  it('saves a valid custom hex color and marks it active', () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByLabelText('Custom accent hex code');

    fireEvent.change(input, { target: { value: 'fc8da9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save custom accent color' }));

    expect(document.documentElement.getAttribute('data-accent')).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#fc8da9');
    expect(localStorage.getItem('relay-accent')).toBe('custom');
    expect(localStorage.getItem('relay-custom-accent')).toBe('#fc8da9');
    expect(localStorage.getItem('relay-custom-accents')).toBe('["#fc8da9"]');
    expect(screen.getByRole('radio', { name: /^Custom \d, #fc8da9$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('uses a format placeholder rather than a colour that reads as a set value', () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByLabelText('Custom accent hex code')).toHaveAttribute(
      'placeholder',
      '#rrggbb',
    );
  });

  it('keeps Save enabled and, when empty, focuses the hex field with its error and saves nothing', () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByLabelText('Custom accent hex code');
    const save = screen.getByRole('button', { name: 'Save custom accent color' });

    expect(save).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/Preview only/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pick custom accent color')).toHaveClass(
      'custom-accent-color-input--empty',
    );

    fireEvent.click(save);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a 3 or 6 digit hex color.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 3 or 6 digit hex color.');
    expect(localStorage.getItem('relay-accent')).toBeNull();
    expect(localStorage.getItem('relay-custom-accents')).toBeNull();

    fireEvent.change(input, { target: { value: '#123456' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText('Preview only. #123456 is not the current accent until you save it.'),
    ).toBeInTheDocument();
  });

  it('saves up to four custom hex colors and replaces the oldest slot', () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByLabelText('Custom accent hex code');
    const saveButton = screen.getByRole('button', { name: 'Save custom accent color' });

    ['#111111', '#222222', '#333333', '#444444', '#555555'].forEach((hex) => {
      fireEvent.change(input, { target: { value: hex } });
      fireEvent.click(saveButton);
    });

    expect(localStorage.getItem('relay-custom-accents')).toBe(
      '["#222222","#333333","#444444","#555555"]',
    );
    expect(screen.queryByRole('radio', { name: /^Custom \d, #111111$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Custom \d, #555555$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('selects and removes saved custom accent swatches', () => {
    localStorage.setItem('relay-custom-accents', '["#fc8da9","#22c55e"]');
    localStorage.setItem('relay-custom-accent', '#fc8da9');
    localStorage.setItem('relay-accent', 'custom');

    render(<SettingsModal {...defaultProps} />);
    const greenCustom = screen.getByRole('radio', { name: /^Custom \d, #22c55e$/ });

    fireEvent.click(greenCustom);

    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22c55e');
    expect(localStorage.getItem('relay-custom-accent')).toBe('#22c55e');
    expect(greenCustom).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Remove custom accent #22c55e' }));

    expect(localStorage.getItem('relay-custom-accents')).toBe('["#fc8da9"]');
    expect(screen.queryByRole('radio', { name: /^Custom \d, #22c55e$/ })).not.toBeInTheDocument();
  });

  it('shows validation feedback and does not save invalid custom hex colors', () => {
    render(<SettingsModal {...defaultProps} />);
    const input = screen.getByLabelText('Custom accent hex code');

    fireEvent.change(input, { target: { value: '#not-pink' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a 3 or 6 digit hex color.')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save custom accent color' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(input).toHaveFocus();
    expect(localStorage.getItem('relay-accent')).toBeNull();
    expect(localStorage.getItem('relay-custom-accents')).toBeNull();
  });

  it('preserves an unsaved custom accent draft across Settings page navigation', () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.change(screen.getByLabelText('Custom accent hex code'), {
      target: { value: '#123456' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));

    expect(screen.getByLabelText('Custom accent hex code')).toHaveValue('#123456');
  });

  it('renders fixed Central Time accent schedule controls', () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Accent schedule' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Auto accent schedule' })).not.toBeChecked();
    const dayAccent = screen.getByLabelText('Day accent');
    expect(dayAccent).toBeDisabled();
    expect(dayAccent).toHaveAccessibleDescription('Turn on Auto accent schedule to choose accents');
    expect(screen.queryByText(/^Needs /)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Day accent')).toHaveValue('red');
    expect(screen.getByLabelText('Swing accent')).toHaveValue('yellow');
    expect(screen.getByLabelText('Night accent')).toHaveValue('blue');
    expect(screen.getByText('6 AM–2 PM CT')).toBeInTheDocument();
    expect(screen.getByText('2 PM–10 PM CT')).toBeInTheDocument();
    expect(screen.getByText('10 PM–6 AM CT')).toBeInTheDocument();
  });

  it('updates the active shift accent on the fly when schedule is enabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T11:30:00Z'));
    render(<SettingsModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Auto accent schedule' }));
    fireEvent.change(screen.getByLabelText('Day accent'), { target: { value: 'pink' } });

    expect(document.documentElement.getAttribute('data-accent')).toBe('pink');
    expect(localStorage.getItem('relay-accent-schedule')).toBe(
      '{"enabled":true,"slots":{"day":"pink","swing":"yellow","night":"blue"}}',
    );
  });

  it('offers saved custom colors as schedule choices', () => {
    localStorage.setItem('relay-custom-accents', '["#2dd4bf"]');

    render(<SettingsModal {...defaultProps} />);

    expect(
      within(screen.getByLabelText('Night accent')).getByRole('option', {
        name: 'Custom 1 #2dd4bf',
      }),
    ).toHaveValue('custom:#2dd4bf');
  });

  it('moves focus and selection through accent swatches with arrow keys (roving tabindex)', () => {
    render(<SettingsModal {...defaultProps} />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Accent color' })).getAllByRole(
      'radio',
    );
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([radios[0]]);

    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('tabindex', '0');
    expect(radios[0]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(radios[1]!, { key: 'End' });
    expect(radios.at(-1)).toHaveFocus();
    fireEvent.keyDown(radios.at(-1)!, { key: 'ArrowRight' });
    expect(radios[0]).toHaveFocus();
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('labels the custom accent remove button with an icon instead of a literal x', () => {
    localStorage.setItem('relay-custom-accents', '["#2dd4bf"]');
    render(<SettingsModal {...defaultProps} />);
    const remove = screen.getByRole('button', { name: 'Remove custom accent #2dd4bf' });
    expect(remove).toHaveTextContent('');
    expect(remove.querySelector('svg')).not.toBeNull();
  });
});
