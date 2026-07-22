import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import type { StartupStateController } from './startupState';
import type { StartupTimeline } from './startupTimeline';

export function shouldExitAfterStartupBenchmark(environment: NodeJS.ProcessEnv): boolean {
  return environment.RELAY_BENCHMARK_EXIT_AFTER_RENDER === '1';
}

export function setupStartupIpc(
  controller: StartupStateController,
  timeline: StartupTimeline,
  options: { onRendererMounted?: () => void } = {},
): () => void {
  const getState = (event: Electron.IpcMainInvokeEvent) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.STARTUP_GET_STATE)) {
      throw new Error('Untrusted startup state request.');
    }
    return controller.getSnapshot();
  };
  const rendererMounted = (event: Electron.IpcMainEvent) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.STARTUP_RENDERER_MOUNTED)) return;
    timeline.mark('renderer-mounted');
    const summary = timeline.takeSummary();
    if (summary) {
      loggers.main.info(summary);
      options.onRendererMounted?.();
    }
  };
  const unsubscribe = controller.subscribe((snapshot) => {
    broadcastToAllWindows(IPC_CHANNELS.STARTUP_STATE_CHANGED, snapshot);
  });

  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_STATE, getState);
  ipcMain.on(IPC_CHANNELS.STARTUP_RENDERER_MOUNTED, rendererMounted);

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC_CHANNELS.STARTUP_GET_STATE);
    ipcMain.removeListener(IPC_CHANNELS.STARTUP_RENDERER_MOUNTED, rendererMounted);
  };
}
