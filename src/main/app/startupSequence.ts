import type { StartupStateController } from './startupState';

export function assertRequiredStartupSucceeded(
  succeeded: boolean,
  failureMessage: string,
): asserts succeeded {
  if (!succeeded) throw new Error(failureMessage);
}

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
    const workspaceReady = options.prepareWorkspace().then((result) => {
      options.controller.transition(generation, 'ready');
      return result;
    });
    const [result] = await Promise.all([workspaceReady, windowReady]);

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
