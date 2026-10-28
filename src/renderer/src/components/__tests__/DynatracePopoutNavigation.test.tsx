import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { DynatraceNavigationState } from '@shared/dynatrace';
import { DynatracePopoutNavigation } from '../DynatracePopoutNavigation';

describe('DynatracePopoutNavigation', () => {
  const originalApi = globalThis.api;

  afterEach(() => {
    globalThis.api = originalApi;
  });

  function stubApi() {
    const listeners: Array<(state: DynatraceNavigationState) => void> = [];
    const unsubscribe = vi.fn();
    const api = {
      platform: 'darwin',
      navigateDynatrace: vi.fn(async () => true),
      onDynatraceNavigationState: vi.fn((callback: (state: DynatraceNavigationState) => void) => {
        listeners.push(callback);
        return unsubscribe;
      }),
    };
    globalThis.api = api as unknown as BridgeAPI;
    const publish = (state: DynatraceNavigationState) => {
      for (const listener of listeners) listener(state);
    };
    return { api, publish, unsubscribe };
  }

  it('enables history buttons only when the page has somewhere to go', () => {
    const { publish } = stubApi();
    render(<DynatracePopoutNavigation />);

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();

    act(() => publish({ canGoBack: true, canGoForward: false }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it('names the hovered action and its shortcut beside the group, even when disabled', async () => {
    stubApi();
    render(<DynatracePopoutNavigation />);

    fireEvent.mouseOver(screen.getByRole('button', { name: 'Back' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Back (⌘[)');

    fireEvent.mouseOver(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reload (⌘R)');
  });

  it('sends the chosen action to the page and unsubscribes on unmount', () => {
    const { api, publish, unsubscribe } = stubApi();
    const { unmount } = render(<DynatracePopoutNavigation />);
    act(() => publish({ canGoBack: true, canGoForward: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(api.navigateDynatrace.mock.calls).toEqual([['back'], ['forward'], ['reload']]);

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('renders nothing where the bridge cannot drive a popout', () => {
    globalThis.api = { platform: 'darwin' } as unknown as BridgeAPI;
    const { container } = render(<DynatracePopoutNavigation />);
    expect(container).toBeEmptyDOMElement();
  });
});
