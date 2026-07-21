import { describe, expect, it, vi } from 'vitest';
import { createStartupStateController } from './startupState';
import { runStartupSequence } from './startupSequence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('runStartupSequence', () => {
  it('starts window creation without waiting for required workspace preparation', async () => {
    const controller = createStartupStateController();
    const workspace = deferred<string>();
    const createWindow = vi.fn().mockResolvedValue(undefined);
    const sequence = runStartupSequence({
      controller,
      createWindow,
      prepareWorkspace: () => workspace.promise,
    });

    expect(createWindow).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe('preparing-data');

    workspace.resolve('configured');
    await expect(sequence).resolves.toBe('configured');
    expect(controller.getSnapshot().phase).toBe('ready');
  });

  it('publishes failure when either required preparation or the window rejects', async () => {
    const controller = createStartupStateController();

    await expect(
      runStartupSequence({
        controller,
        createWindow: async () => undefined,
        prepareWorkspace: async () => {
          throw new Error('database unavailable');
        },
        failureMessage: 'Relay could not prepare its workspace.',
      }),
    ).rejects.toThrow('database unavailable');

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'failed',
      message: 'Relay could not prepare its workspace.',
    });
  });

  it('does not let post-ready work delay completion', async () => {
    const controller = createStartupStateController();
    const postReady = vi.fn(() => new Promise<void>(() => undefined));

    await expect(
      runStartupSequence({
        controller,
        createWindow: async () => undefined,
        prepareWorkspace: async () => 'ready',
        postReady,
      }),
    ).resolves.toBe('ready');

    expect(postReady).toHaveBeenCalledWith('ready');
  });
});
