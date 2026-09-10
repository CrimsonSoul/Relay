import { useState } from 'react';
import { Modal } from '../Modal';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { UnsupportedViewport } from '../UnsupportedViewport';

describe('UnsupportedViewport', () => {
  afterEach(() => {
    globalThis.api = undefined;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('retains a portaled draft and deferred operation across a narrow interval', async () => {
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    function Workspace() {
      const [value, setValue] = useState('');
      const [status, setStatus] = useState('Apply');
      return (
        <Modal isOpen onClose={() => {}} title="Sync">
          <input
            aria-label="Draft"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            onClick={async () => {
              setStatus('Applying');
              await pending;
              setStatus('Completed 4 deletes');
            }}
          >
            {status}
          </button>
        </Modal>
      );
    }
    render(
      <UnsupportedViewport>
        <Workspace />
      </UnsupportedViewport>,
    );
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByText('Apply'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep me');
    expect(screen.getByLabelText('Draft').closest('[inert]')).not.toBeNull();
    await act(async () => finish());
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep me');
    expect(screen.getByText('Completed 4 deletes')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft').closest('[inert]')).toBeNull();
  });

  it('shows the normal shell at 1024 CSS pixels', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    render(
      <UnsupportedViewport>
        <button type="button">Dense control</button>
      </UnsupportedViewport>,
    );
    expect(screen.getByRole('button', { name: 'Dense control' })).toBeInTheDocument();
  });

  it('replaces dense controls with a focusable larger-window state below 1024 pixels', () => {
    globalThis.api = { runtime: WEB_RUNTIME } as never;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1023 });
    render(
      <UnsupportedViewport>
        <button type="button">Dense control</button>
      </UnsupportedViewport>,
    );

    const state = screen.getByRole('main', { name: 'Larger window required' });
    expect(state).toHaveFocus();
    expect(state).toHaveTextContent('Maximize the window or reduce browser zoom');
    expect(screen.queryByRole('button', { name: 'Dense control' })).not.toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('button', { name: 'Dense control' })).toBeInTheDocument();
  });
});
