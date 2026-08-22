import { clipboard, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../../logger';
import { assertTrustedIpcSender } from '../../utils/trustedSender';

const MAX_CLIPBOARD_LENGTH = 1_048_576;

export function registerClipboardWriteHandler(): void {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (event, text: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CLIPBOARD_WRITE)) return false;
    try {
      if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_LENGTH) return false;
      clipboard.writeText(text);
      return true;
    } catch (err) {
      loggers.ipc.warn('Clipboard write failed', { error: getErrorMessage(err) });
      return false;
    }
  });
}
