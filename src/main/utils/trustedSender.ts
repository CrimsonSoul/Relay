import { app } from 'electron';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loggers } from '../logger';

// dist/main/ when bundled — same convention as windowFactory.ts
const mainDir = dirname(fileURLToPath(import.meta.url));

export function isAllowedRendererFileUrl(url: string, rendererDir: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;

    const rendererRoot = resolve(rendererDir);
    const targetPath = resolve(fileURLToPath(parsed));
    const relativePath = relative(rendererRoot, targetPath);

    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
  } catch {
    return false;
  }
}

type SenderEvent = {
  senderFrame: Electron.WebFrameMain | null;
  sender: Electron.WebContents;
};

/**
 * Defense-in-depth: every IPC sender must be the main frame of a window
 * showing our renderer (dev-server origin in dev, dist/renderer file: URL in
 * prod). Navigation lockdown makes other senders unreachable today; this
 * guard keeps that true if a navigation guard ever regresses.
 */
export function isTrustedIpcSender(event: SenderEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    try {
      if (new URL(frame.url).origin === new URL(devUrl).origin) return true;
    } catch {
      /* fall through to file check */
    }
  }
  return isAllowedRendererFileUrl(frame.url, join(mainDir, '../renderer'));
}

/** Guard for handler entry points: logs and returns false for untrusted senders. */
export function assertTrustedIpcSender(event: SenderEvent, channel: string): boolean {
  if (isTrustedIpcSender(event)) return true;
  loggers.security.warn('Rejected IPC from untrusted sender', { channel });
  return false;
}
