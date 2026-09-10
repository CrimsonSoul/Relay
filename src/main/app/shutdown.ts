import type { App, BrowserWindow } from 'electron';

/** Windows session end does not emit the app before-quit event. */
export function registerShutdownHandlers({
  app,
  windows,
  cleanup,
  recordExit,
  platform = process.platform,
}: {
  app: Pick<App, 'on'>;
  windows: BrowserWindow[];
  cleanup: () => void;
  recordExit: (reason: string) => void;
  platform?: NodeJS.Platform;
}): void {
  let completed = false;
  const shutdown = (reason: string): void => {
    if (completed) return;
    completed = true;
    recordExit(reason);
    cleanup();
  };
  app.on('before-quit', () => shutdown('before-quit'));
  if (platform !== 'win32') return;
  const attach = (window: BrowserWindow): void => {
    window.on('session-end', () => shutdown('session-end'));
  };
  windows.forEach(attach);
  app.on('browser-window-created', (_event, window) => attach(window));
}
