import type { App, BrowserWindow } from 'electron';
import { win32 } from 'node:path';

export const RELAY_WINDOWS_APP_USER_MODEL_ID = 'com.operators.relay';

type WindowsApplicationIdentityRuntime = Readonly<{
  platform: string;
  isPackaged: boolean;
}>;

type WindowsWindowIdentityRuntime = WindowsApplicationIdentityRuntime &
  Readonly<{
    execPath: string;
  }>;

export function resolveStableWindowsLauncher(execPath: string): string | null {
  const buildDirectory = win32.dirname(execPath);
  const runtimeDirectory = win32.dirname(buildDirectory);
  const relayRoot = win32.dirname(runtimeDirectory);
  if (win32.basename(runtimeDirectory).toLowerCase() !== 'runtime') return null;
  if (win32.basename(relayRoot).toLowerCase() !== 'relay') return null;
  return win32.join(relayRoot, 'Relay.exe');
}

export function configureWindowsApplicationIdentity(
  application: Pick<App, 'setAppUserModelId'>,
  runtime: WindowsApplicationIdentityRuntime,
): void {
  if (runtime.platform !== 'win32' || !runtime.isPackaged) return;
  application.setAppUserModelId(RELAY_WINDOWS_APP_USER_MODEL_ID);
}

export function configureWindowsTaskbarWindow(
  window: Pick<BrowserWindow, 'setAppDetails'>,
  runtime: WindowsWindowIdentityRuntime,
): void {
  if (runtime.platform !== 'win32' || !runtime.isPackaged) return;
  const launcherPath = resolveStableWindowsLauncher(runtime.execPath);
  if (!launcherPath) return;
  window.setAppDetails({
    appId: RELAY_WINDOWS_APP_USER_MODEL_ID,
    appIconPath: launcherPath,
    appIconIndex: 0,
    relaunchCommand: `"${launcherPath}"`,
    relaunchDisplayName: 'Relay',
  });
}
