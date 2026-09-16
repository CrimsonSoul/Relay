import type { App, BrowserWindow } from 'electron';

/** Windows session end does not emit the app before-quit event. */
export function registerShutdownHandlers({
  app,
  windows,
  cleanup,
  platform = process.platform,
}: {
  app: Pick<App, 'on'>;
  windows: BrowserWindow[];
  cleanup: () => void;
  platform?: NodeJS.Platform;
}): void {
  let completed = false;
  const shutdown = (): void => {
    if (completed) return;
    completed = true;
    cleanup();
  };
  app.on('before-quit', shutdown);
  if (platform !== 'win32') return;
  const attach = (window: BrowserWindow): void => {
    window.on('session-end', shutdown);
  };
  windows.forEach(attach);
  app.on('browser-window-created', (_event, window) => attach(window));
}
