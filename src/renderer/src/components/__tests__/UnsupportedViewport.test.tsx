import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { UnsupportedViewport } from '../UnsupportedViewport';

describe('UnsupportedViewport', () => {
  afterEach(() => {
    globalThis.api = undefined;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
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
    expect(screen.queryByRole('button', { name: 'Dense control' })).not.toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('button', { name: 'Dense control' })).toBeInTheDocument();
  });
});
