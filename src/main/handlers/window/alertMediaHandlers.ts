import { dialog, ipcMain, nativeImage, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename, extname, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS, MAX_IMAGE_DATA_URL_LENGTH } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../../logger';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { pickImageFile } from './imageFilePicker';

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const MAX_ALERT_BODY_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_ALERT_BODY_IMAGE_WIDTH = 516;

type PickedImage =
  | { success: true; image: Electron.NativeImage; filePath: string }
  | { success: false; error: string };

async function pickAndResizeImage(options: {
  title: string;
  maxBytes: number;
  maxWidth: number;
  sizeError: string;
}): Promise<PickedImage> {
  const picked = await pickImageFile(options);
  if (!picked.success) return picked;

  let image = nativeImage.createFromBuffer(picked.buffer);
  if (image.isEmpty()) return { success: false, error: 'Invalid image file' };

  const { width } = image.getSize();
  if (width > options.maxWidth) {
    image = image.resize({ width: options.maxWidth });
  }
  return { success: true, image, filePath: picked.filePath };
}

function sanitizePngSuggestedName(suggestedName: unknown): string {
  if (typeof suggestedName !== 'string') return 'alert.png';
  const parsed = parse(basename(suggestedName.trim()));
  const stem = parsed.name.replaceAll(/[^a-zA-Z0-9._ -]/g, '').trim();
  return `${stem || 'alert'}.png`;
}

export function registerAlertPlaySoundHandler(): void {
  ipcMain.handle(IPC_CHANNELS.ALERT_PLAY_SOUND, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_PLAY_SOUND)) return false;
    try {
      shell.beep();
      return true;
    } catch (err) {
      loggers.ipc.warn('Alert sound failed', { error: getErrorMessage(err) });
      return false;
    }
  });
}

export function registerAlertSelectReminderSoundHandler(): void {
  ipcMain.handle(IPC_CHANNELS.ALERT_SELECT_REMINDER_SOUND, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_SELECT_REMINDER_SOUND)) {
      return { success: false, error: 'Untrusted sender' };
    }
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Reminder Alarm MP3',
        filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
        properties: ['openFile'],
      });
      const filePath = filePaths[0];
      if (canceled || !filePath) return { success: false, error: 'Cancelled' };
      if (extname(filePath).toLowerCase() !== '.mp3') {
        return { success: false, error: 'Select an MP3 file' };
      }
      return { success: true, data: pathToFileURL(filePath).href };
    } catch (err) {
      loggers.ipc.warn('Reminder sound selection failed', { error: getErrorMessage(err) });
      return { success: false, error: err instanceof Error ? err.message : 'Selection failed' };
    }
  });
}

export function registerSelectAlertBodyImageHandler(): void {
  ipcMain.handle(IPC_CHANNELS.SELECT_ALERT_BODY_IMAGE, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SELECT_ALERT_BODY_IMAGE)) {
      return { success: false, error: 'Untrusted sender' };
    }
    try {
      const picked = await pickAndResizeImage({
        title: 'Insert Alert Image',
        maxBytes: MAX_ALERT_BODY_IMAGE_SIZE,
        maxWidth: MAX_ALERT_BODY_IMAGE_WIDTH,
        sizeError: 'Image must be under 5MB',
      });
      if (!picked.success) return picked;

      if (extname(picked.filePath).toLowerCase() === '.png') {
        return {
          success: true,
          data: PNG_DATA_URL_PREFIX + picked.image.toPNG().toString('base64'),
        };
      }
      return {
        success: true,
        data: 'data:image/jpeg;base64,' + picked.image.toJPEG(82).toString('base64'),
      };
    } catch (err) {
      loggers.ipc.warn('Alert body image selection failed', { error: getErrorMessage(err) });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Image selection failed',
      };
    }
  });
}

export function registerOptimizeAlertImageHandler(): void {
  ipcMain.handle(IPC_CHANNELS.OPTIMIZE_ALERT_IMAGE, async (event, dataUrl: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OPTIMIZE_ALERT_IMAGE)) {
      return { success: false, error: 'Untrusted sender' };
    }
    try {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
        return { success: false, error: 'Invalid image data' };
      }
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return { success: false, error: 'Image data exceeds size limit' };
      }

      const sourceBuffer = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
      if (sourceBuffer.length === 0) {
        return { success: false, error: 'Invalid image data' };
      }

      const { default: sharp } = await import('sharp');
      const optimizedBuffer = await sharp(sourceBuffer)
        .withMetadata({ density: 96 })
        .png({ adaptiveFiltering: true, compressionLevel: 9, effort: 10 })
        .toBuffer();

      const optimizedDataUrl = PNG_DATA_URL_PREFIX + optimizedBuffer.toString('base64');
      if (optimizedDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return { success: false, error: 'Prepared image exceeds size limit' };
      }
      return { success: true, data: optimizedDataUrl };
    } catch (err) {
      loggers.ipc.warn('Alert image optimization failed', { error: getErrorMessage(err) });
      return { success: false, error: 'Optimization failed' };
    }
  });
}

export function registerSaveAlertImageHandler(): void {
  ipcMain.handle(
    IPC_CHANNELS.SAVE_ALERT_IMAGE,
    async (event, dataUrl: string, suggestedName: string) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.SAVE_ALERT_IMAGE)) {
        return { success: false, error: 'Untrusted sender' };
      }
      try {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
          return { success: false, error: 'Invalid image data' };
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
          return { success: false, error: 'Image data exceeds size limit' };
        }
        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) return { success: false, error: 'Invalid image data' };
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: sanitizePngSuggestedName(suggestedName),
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (canceled || !filePath) return { success: false, error: 'Cancelled' };
        await writeFile(filePath, image.toPNG());
        return { success: true, data: filePath };
      } catch (err) {
        loggers.ipc.warn('Alert image save failed', { error: getErrorMessage(err) });
        return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
      }
    },
  );
}
