import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEffect, type ComponentType } from 'react';
import type { StartupSnapshot } from '@shared/ipc';
import { DesktopStartupGate, type DesktopStartupBridge } from './DesktopStartupGate';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const preparing: StartupSnapshot = {
  generation: 1,
  sequence: 2,
  phase: 'preparing-data',
  message: 'Preparing Relay data…',
};

function makeBridge(snapshot: StartupSnapshot = preparing) {
  let listener: ((value: StartupSnapshot) => void) | undefined;
  const bridge: DesktopStartupBridge = {
    getStartupState: vi.fn().mockResolvedValue(snapshot),
    onStartupStateChanged: vi.fn((callback) => {
      listener = callback;
      return vi.fn();
    }),
    markStartupRendererMounted: vi.fn(),
  };
  return {
    bridge,
    emit: (value: StartupSnapshot) => listener?.(value),
  };
}

describe('DesktopStartupGate', () => {
  it('starts loading App immediately and subscribes before reading startup state', async () => {
    const order: string[] = [];
    const appModule = deferred<{ default: ComponentType }>();
    const { bridge } = makeBridge();
    vi.mocked(bridge.onStartupStateChanged).mockImplementation((_callback) => {
      order.push('subscribe');
      return vi.fn();
    });
    vi.mocked(bridge.getStartupState).mockImplementation(async () => {
      order.push('read');
      return preparing;
    });

    render(
      <DesktopStartupGate
        bridge={bridge}
        loadApp={() => {
          order.push('load');
          return appModule.promise;
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Starting Relay');
    expect(order).toEqual(['load', 'subscribe', 'read']);
  });

  it('keeps the shell after App loads until main reports ready', async () => {
    const { bridge, emit } = makeBridge();
    const App = () => <main>Operational workspace</main>;

    render(<DesktopStartupGate bridge={bridge} loadApp={async () => ({ default: App })} />);

    expect(await screen.findByText('Preparing Relay data…')).toBeInTheDocument();
    expect(screen.queryByText('Operational workspace')).not.toBeInTheDocument();

    await act(async () => {
      emit({ ...preparing, sequence: 3, phase: 'ready', message: 'Relay is ready.' });
    });
    expect(await screen.findByText('Operational workspace')).toBeInTheDocument();
  });

  it('ignores an older snapshot returned after a newer event', async () => {
    const initial = deferred<StartupSnapshot>();
    const { bridge, emit } = makeBridge();
    vi.mocked(bridge.getStartupState).mockReturnValue(initial.promise);
    const App = () => <main>Operational workspace</main>;

    render(<DesktopStartupGate bridge={bridge} loadApp={async () => ({ default: App })} />);
    await waitFor(() => expect(bridge.onStartupStateChanged).toHaveBeenCalled());

    await act(async () => {
      emit({ ...preparing, sequence: 4, phase: 'ready', message: 'Relay is ready.' });
      initial.resolve(preparing);
    });

    expect(await screen.findByText('Operational workspace')).toBeInTheDocument();
  });

  it('renders a semantic failure state', async () => {
    const { bridge } = makeBridge({
      ...preparing,
      sequence: 3,
      phase: 'failed',
      message: 'Relay could not prepare its data.',
    });

    render(<DesktopStartupGate bridge={bridge} loadApp={() => new Promise(() => undefined)} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Relay could not prepare its data.');
  });

  it('reports the first mounted application once', async () => {
    const { bridge, emit } = makeBridge({
      ...preparing,
      sequence: 3,
      phase: 'ready',
      message: 'Relay is ready.',
    });
    const App = () => <main>Operational workspace</main>;

    render(<DesktopStartupGate bridge={bridge} loadApp={async () => ({ default: App })} />);
    expect(await screen.findByText('Operational workspace')).toBeInTheDocument();
    expect(bridge.markStartupRendererMounted).toHaveBeenCalledTimes(1);

    await act(async () => {
      emit({ ...preparing, sequence: 4, phase: 'ready', message: 'Still ready.' });
    });
    expect(bridge.markStartupRendererMounted).toHaveBeenCalledTimes(1);
  });

  it('reports the mounted application at commit before App passive effects', async () => {
    const order: string[] = [];
    const { bridge } = makeBridge({
      ...preparing,
      sequence: 3,
      phase: 'ready',
      message: 'Relay is ready.',
    });
    vi.mocked(bridge.markStartupRendererMounted).mockImplementation(() => {
      order.push('renderer-mounted');
    });
    const App = () => {
      useEffect(() => {
        order.push('app-passive-effect');
      }, []);
      return <main>Operational workspace</main>;
    };

    render(<DesktopStartupGate bridge={bridge} loadApp={async () => ({ default: App })} />);

    expect(await screen.findByText('Operational workspace')).toBeInTheDocument();
    await waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(['renderer-mounted', 'app-passive-effect']);
  });
});
