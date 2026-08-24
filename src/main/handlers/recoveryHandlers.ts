import { ipcMain, type IpcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { RecoveryHandlerRuntimeOptions } from './recoveryHandlerRuntime';

type RecoveryHandlerOptions = RecoveryHandlerRuntimeOptions & {
  ipcMain?: Pick<IpcMain, 'handle'>;
};

type RecoveryHandlerRuntime = ReturnType<
  typeof import('./recoveryHandlerRuntime').createRecoveryHandlerRuntime
>;

export function setupRecoveryHandlers(options: RecoveryHandlerOptions): void {
  const ipc = options.ipcMain ?? ipcMain;
  let runtimePromise: Promise<RecoveryHandlerRuntime> | null = null;
  const getHandlerRuntime = () => {
    runtimePromise ??= import('./recoveryHandlerRuntime').then(({ createRecoveryHandlerRuntime }) =>
      createRecoveryHandlerRuntime(options),
    );
    return runtimePromise;
  };

  ipc.handle(IPC_CHANNELS.APP_RECOVERY_GET_STATE, async (event) =>
    (await getHandlerRuntime()).getState(event),
  );
  ipc.handle(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, async (event, input: unknown) =>
    (await getHandlerRuntime()).rollback(event, input),
  );
  ipc.handle(IPC_CHANNELS.APP_RECOVERY_REPAIR, async (event, input: unknown) =>
    (await getHandlerRuntime()).repair(event, input),
  );
}
