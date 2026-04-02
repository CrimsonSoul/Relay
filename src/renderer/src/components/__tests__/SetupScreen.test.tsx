import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetupScreen } from '../SetupScreen';

// Mock the Input component to simplify testing
vi.mock('../Input', () => ({
  Input: ({
    label,
    value,
    onChange,
    type,
    placeholder,
    ...props
  }: {
    label?: string;
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    type?: string;
    placeholder?: string;
  }) => (
    <div>
      {label && <label htmlFor={label}>{label}</label>}
      <input
        id={label}
        value={value}
        onChange={onChange}
        type={type}
        placeholder={placeholder}
        aria-label={label}
        {...props}
      />
    </div>
  ),
}));

describe('SetupScreen', () => {
  const SECRET_FIELD = 'secret';
  const createFixturePassphrase = () => ['fixture', 'passphrase', '123'].join('-');
  const validPassphrase = createFixturePassphrase();
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  const CLIENT_URL = 'http://192.168.1.50:8090';
  const getSubmittedConfig = () => onComplete.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onComplete = vi.fn();
    // Mock window.api for the CloseButton
    (globalThis as unknown as { window: { api: { windowClose: () => void } } }).window = {
      api: { windowClose: vi.fn() },
    } as unknown as typeof globalThis.window;
  });

  // ── Initial Render (mode selection) ──

  it('renders mode selection screen initially', () => {
    render(<SetupScreen onComplete={onComplete} />);
    expect(screen.getByText('Relay')).toBeInTheDocument();
    expect(screen.getByText('How will this instance be used?')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
  });

  it('shows Primary Station and Remote Station tags', () => {
    render(<SetupScreen onComplete={onComplete} />);
    expect(screen.getByText('Primary Station')).toBeInTheDocument();
    expect(screen.getByText('Remote Station')).toBeInTheDocument();
  });

  it('renders a close button', () => {
    render(<SetupScreen onComplete={onComplete} />);
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  // ── Mode Selection ──

  it('switches to server configuration when Server is clicked', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    expect(screen.getByText('Configure Relay')).toBeInTheDocument();
    expect(screen.getByText('Server Mode')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
  });

  it('switches to client configuration when Client is clicked', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    expect(screen.getByText('Configure Relay')).toBeInTheDocument();
    expect(screen.getByText('Client Mode')).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
  });

  // ── Server Mode Form ──

  it('shows port input and passphrase input in server mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  it('shows the correct hint for server mode passphrase', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    expect(
      screen.getByText('All stations use this passphrase to authenticate'),
    ).toBeInTheDocument();
  });

  it('shows Save & Start Server button in server mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    expect(screen.getByText('Save & Start Server')).toBeInTheDocument();
  });

  // ── Client Mode Form ──

  it('shows server URL input and passphrase input in client mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  it('shows the correct hint for client mode passphrase', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    expect(screen.getByText('Must match the passphrase on the server')).toBeInTheDocument();
  });

  it('shows Save & Connect button in client mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    expect(screen.getByText('Save & Connect')).toBeInTheDocument();
  });

  // ── Back Button ──

  it('goes back to mode selection when Back is clicked', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    expect(screen.getByText('Configure Relay')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('How will this instance be used?')).toBeInTheDocument();
  });

  it('clears error when going back', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    // Submit without passphrase to trigger error
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Passphrase is required')).toBeInTheDocument();
    // Go back
    fireEvent.click(screen.getByText('Back'));
    // Come back to server
    fireEvent.click(screen.getByText('Server'));
    expect(screen.queryByText('Passphrase is required')).not.toBeInTheDocument();
  });

  // ── Password Toggle ──

  it('toggles password visibility', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    const passwordInput = screen.getByLabelText('Passphrase');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Click show passphrase button
    fireEvent.click(screen.getByLabelText('Show passphrase'));
    expect(passwordInput).toHaveAttribute('type', 'text');

    // Click hide passphrase button
    fireEvent.click(screen.getByLabelText('Hide passphrase'));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // ── Form Validation ──

  it('shows error when passphrase is empty', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Passphrase is required')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error when passphrase is whitespace-only', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: '       ' } });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Passphrase is required')).toBeInTheDocument();
  });

  it('shows error when passphrase is less than 8 characters', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Passphrase must be at least 8 characters')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error for invalid port (too low)', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Port must be between 1024 and 65535')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error for invalid port (too high)', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '70000' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Port must be between 1024 and 65535')).toBeInTheDocument();
  });

  it('shows error for non-numeric port', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    // Port field strips non-digits, so an empty string after stripping = NaN
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Port must be between 1024 and 65535')).toBeInTheDocument();
  });

  it('shows error when server URL is empty in client mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    expect(screen.getByText('Server URL is required')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error when server URL is whitespace-only in client mode', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    expect(screen.getByText('Server URL is required')).toBeInTheDocument();
  });

  // ── Form Submission ──

  it('calls onComplete with server config on valid server submission', async () => {
    onComplete.mockResolvedValue(undefined);
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '9090' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    await act(async () => {
      fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getSubmittedConfig()).toMatchObject({ mode: 'server', port: 9090 });
    expect(getSubmittedConfig()[SECRET_FIELD]).toBe(validPassphrase);
  });

  it('calls onComplete with client config on valid client submission', async () => {
    onComplete.mockResolvedValue(undefined);
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: CLIENT_URL },
    });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    await act(async () => {
      fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getSubmittedConfig()).toMatchObject({ mode: 'client', serverUrl: CLIENT_URL });
    expect(getSubmittedConfig()[SECRET_FIELD]).toBe(validPassphrase);
  });

  it('trims server URL before submitting in client mode', async () => {
    onComplete.mockResolvedValue(undefined);
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: `  ${CLIENT_URL}  ` },
    });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    await act(async () => {
      fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getSubmittedConfig()).toMatchObject({ mode: 'client', serverUrl: CLIENT_URL });
    expect(getSubmittedConfig()[SECRET_FIELD]).toBe(validPassphrase);
  });

  // ── Loading State ──

  it('shows loading state during server submission', async () => {
    // Make onComplete hang (never resolve)
    onComplete.mockReturnValue(new Promise(() => {}));
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '8090' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    // Use act to flush the synchronous state update (setLoading(true))
    // but don't await the full promise (it never resolves)
    act(() => {
      fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    });

    expect(screen.getByText('Starting Server...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Starting Server/i })).toBeDisabled();
  });

  it('shows loading state during client submission', async () => {
    onComplete.mockReturnValue(new Promise(() => {}));
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: CLIENT_URL },
    });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    act(() => {
      fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    });

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  // ── Error Recovery ──

  it('resets loading state when onComplete throws in server mode', async () => {
    onComplete.mockRejectedValue(new Error('Server start failed'));
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '8090' } });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    await act(async () => {
      fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    });

    expect(screen.getByText('Save & Start Server')).toBeInTheDocument();
  });

  it('resets loading state when onComplete throws in client mode', async () => {
    onComplete.mockRejectedValue(new Error('Connection failed'));
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Client'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: CLIENT_URL },
    });
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: validPassphrase },
    });
    await act(async () => {
      fireEvent.submit(screen.getByText('Save & Connect').closest('form')!);
    });

    expect(screen.getByText('Save & Connect')).toBeInTheDocument();
  });

  it('clears previous error on new submission attempt', () => {
    render(<SetupScreen onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Server'));
    // Trigger an error
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.getByText('Passphrase is required')).toBeInTheDocument();

    // Fill in passphrase (still short) and resubmit - previous error should be replaced
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByText('Save & Start Server').closest('form')!);
    expect(screen.queryByText('Passphrase is required')).not.toBeInTheDocument();
    expect(screen.getByText('Passphrase must be at least 8 characters')).toBeInTheDocument();
  });
});
