import type { StartupStateController } from './startupState';

type StartupSequenceOptions<T> = {
  controller: StartupStateController;
  createWindow: () => Promise<void>;
  prepareWorkspace: () => Promise<T>;
  failureMessage?: string;
  postReady?: (result: T) => void | Promise<void>;
  onPostReadyError?: (error: unknown) => void;
};

export async function runStartupSequence<T>(options: StartupSequenceOptions<T>): Promise<T> {
  const generation = options.controller.beginGeneration();
  options.controller.transition(generation, 'preparing-data');

  try {
    const windowReady = options.createWindow();
    const [result] = await Promise.all([options.prepareWorkspace(), windowReady]);
    // Publish ready only once both required steps settled: a window that fails
    // after the workspace resolved must still reach the failed phase.
    options.controller.transition(generation, 'ready');

    if (options.postReady) {
      try {
        void Promise.resolve(options.postReady(result)).catch(
          options.onPostReadyError ?? (() => undefined),
        );
      } catch (error) {
        options.onPostReadyError?.(error);
      }
    }
    return result;
  } catch (error) {
    options.controller.transition(
      generation,
      'failed',
      options.failureMessage ?? 'Relay could not finish starting.',
    );
    throw error;
  }
}
