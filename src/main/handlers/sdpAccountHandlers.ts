import { writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import {
  SdpAccountCommandSchema,
  type SdpAccountView,
  SdpServerCommandSchema,
  type SdpServerView,
} from '@shared/sdpAccount';
import { sdpBackend, sdpServerCommand } from '../sdp/SdpRuntime';
import type { PrivilegedAccessRuntime } from './privilegedAccessHandlers';
import { SdpAccountSession } from '../sdp/SdpAccountSession';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import { shouldSuppressDesktopSideEffects } from '../app/e2eSafety';

/** OAuth secrets, token exchange and a loopback listener require the desktop process. */
export function setupSdpAccountHandlers(
  getMainWindow: () => BrowserWindow | null,
  getRuntime: () => PrivilegedAccessRuntime | null = () => null,
): void {
  const account = new SdpAccountSession(async (url) => {
    if (shouldSuppressDesktopSideEffects()) throw new Error('External sign-in disabled in tests.');
    await shell.openExternal(url);
  }, sdpBackend);
  app.once('before-quit', () => {
    void account.disconnect().catch(() => undefined);
  });
  ipcMain.handle(
    IPC_CHANNELS.SDP_SERVER,
    async (event, payload: unknown): Promise<IpcResult<SdpServerView>> => {
      if (
        !assertTrustedIpcSender(event, IPC_CHANNELS.SDP_SERVER) ||
        event.sender !== getMainWindow()?.webContents
      )
        return { success: false, error: 'Use the main server window.' };
      const session = getRuntime()?.getView();
      if (session?.state !== 'active' || !['owner', 'admin'].includes(session.role ?? ''))
        return { success: false, error: 'An active server administrator session is required.' };
      const command = SdpServerCommandSchema.safeParse(payload);
      if (!command.success) return { success: false, error: 'Invalid SDP server request.' };
      try {
        return { success: true, data: await sdpServerCommand(command.data) };
      } catch {
        return {
          success: false,
          error:
            'SDP setup could not be saved or loaded. Use the server computer, check protected storage, and refresh settings before retrying.',
        };
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.SDP_ACCOUNT,
    async (event, payload: unknown): Promise<IpcResult<SdpAccountView>> => {
      if (
        !assertTrustedIpcSender(event, IPC_CHANNELS.SDP_ACCOUNT) ||
        event.sender !== getMainWindow()?.webContents
      )
        return {
          success: false,
          error: 'SDP account access is available only in the main desktop window.',
        };
      const parsed = SdpAccountCommandSchema.safeParse(payload);
      if (!parsed.success) return { success: false, error: 'Invalid SDP account request.' };
      try {
        const command = parsed.data;
        if (command.action === 'clearCopies' && app.isPackaged)
          return { success: false, error: 'Test controls are unavailable in release builds.' };
        let data: SdpAccountView;
        switch (command.action) {
          case 'connect':
            data = await account.connect();
            break;
          case 'disconnect':
            data = await account.disconnect();
            break;
          case 'readTestTicket':
            data = await account.readTestTicket();
            break;
          case 'status':
            data = await account.status();
            break;
          default:
            data = await account.invoke(command);
        }
        if (command.action === 'downloadAttachment')
          data = await saveAttachment(data, getMainWindow());
        return { success: true, data: { ...data, testControls: app.isPackaged === false } };
      } catch {
        // Never forward provider errors, callback URLs, credentials or response bodies over IPC.
        return {
          success: false,
          error:
            parsed.data.action === 'connect'
              ? 'Could not open SDP sign-in. Close the standalone login tester on port 8766 and try again.'
              : 'SDP could not complete this action. Check your connection, account permissions, and sign-in status.',
        };
      }
    },
  );
}

async function saveAttachment(
  data: SdpAccountView,
  window: BrowserWindow | null,
): Promise<SdpAccountView> {
  const { attachmentFile, ...view } = data;
  if (!attachmentFile || !window) throw new Error('Attachment unavailable.');
  const chosen = await dialog.showSaveDialog(window, {
    title: 'Save SDP attachment',
    defaultPath: attachmentFile.name,
  });
  if (chosen.canceled || !chosen.filePath) return { ...view, message: 'Download cancelled.' };
  await writeFile(chosen.filePath, Buffer.from(attachmentFile.data, 'base64'), { mode: 0o600 });
  return { ...view, message: 'Attachment saved.' };
}
