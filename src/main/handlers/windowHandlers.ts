import { app, ipcMain, BrowserWindow, clipboard, nativeImage, dialog, shell } from 'electron';
import { execFile } from 'node:child_process';
import { writeFile, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { basename, extname, parse, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOUD_STATUS_PROVIDERS, IPC_CHANNELS, MAX_IMAGE_DATA_URL_LENGTH } from '@shared/ipc';
import { isDynatraceHost } from '@shared/dynatrace';
import { RADAR_URL } from '@shared/radar';
import { getErrorMessage } from '@shared/types';
import { describeUrlForLog } from '@shared/urlSecurity';
import { loggers } from '../logger';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { rateLimiters } from '../rateLimiter';
import { BrandAssetService } from '../services/operationalServices';
import { shouldSuppressDesktopSideEffects } from '../app/e2eSafety';

const MAX_CLIPBOARD_LENGTH = 1_048_576; // 1MB
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

const MAX_ICS_LENGTH = 1_048_576; // 1MB
const MAX_ALERT_DRAFT_EML_LENGTH = 20 * 1024 * 1024; // 20MB
const MAX_ALERT_BODY_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB before resize/compression
const MAX_ALERT_BODY_IMAGE_WIDTH = 516;
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const MAC_OPEN_COMMAND = '/usr/bin/open';

type PickedImage =
  | { success: true; image: Electron.NativeImage; filePath: string }
  | { success: false; error: string };
type PickedImageFile =
  { success: true; buffer: Buffer; filePath: string } | { success: false; error: string };

function execOutputText(value: string | Buffer | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value.trim() : value.toString('utf8').trim();
}

function openMacOutlookDraft(filePath: string): Promise<string> {
  const openWithOutlook = (args: string[]): Promise<string> =>
    new Promise((resolveOpen) => {
      execFile(MAC_OPEN_COMMAND, args, (error, _stdout, stderr) => {
        if (!error) {
          resolveOpen('');
          return;
        }
        resolveOpen(execOutputText(stderr) || getErrorMessage(error));
      });
    });

  return openWithOutlook(['-b', 'com.microsoft.Outlook', filePath]).then(async (bundleError) => {
    if (!bundleError) return '';
    return await openWithOutlook(['-a', 'Microsoft Outlook', filePath]);
  });
}

function openAlertDraftFile(filePath: string): Promise<string> {
  if (process.platform === 'darwin') return openMacOutlookDraft(filePath);
  return shell.openPath(filePath);
}

/**
 * Hands a generated document to another desktop app by path without exposing it
 * to the rest of the machine. A predictable name in the shared temp directory is
 * readable by every local user on Linux, and can be pre-created there as a
 * symlink for writeFile to follow; mkdtemp instead yields a fresh 0700 directory
 * owned by this user. The payload is removed once the opener has taken it, so
 * invites and 20MB alert drafts stop accumulating for the life of the machine.
 *
 * Resolves with the opener's error string, or '' when the document opened.
 */
/**
 * Directories whose document was successfully handed to another app, removed on
 * the NEXT call rather than immediately. On Windows `shell.openPath` resolves
 * once the helper app has been launched — not once it has read the file — so
 * deleting straight away can pull a 20MB draft out from under a cold-starting
 * Outlook. Deferring bounds the residue to a single 0700 directory while giving
 * the opener unbounded time to read.
 */
let handedOffTempDirectories: string[] = [];

async function removeTempDirectory(directory: string): Promise<void> {
  // Best effort — a leftover 0700 directory is not a disclosure risk.
  await rm(directory, { recursive: true, force: true }).catch((err: unknown) => {
    loggers.ipc.warn('Temp document cleanup failed', { error: getErrorMessage(err) });
  });
}

async function openThroughPrivateTempFile(
  fileName: string,
  content: string,
  open: (filePath: string) => Promise<string>,
): Promise<string> {
  const previous = handedOffTempDirectories;
  handedOffTempDirectories = [];
  await Promise.all(previous.map(removeTempDirectory));

  const directory = await mkdtemp(join(app.getPath('temp'), 'relay-'));
  let handedOff = false;
  try {
    const filePath = join(directory, fileName);
    await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
    const openError = await open(filePath);
    handedOff = openError === '';
    return openError;
  } finally {
    // Nothing consumed the file if the open threw or reported an error, so it
    // can go now; only a real hand-off has to outlive this call.
    if (handedOff) handedOffTempDirectories.push(directory);
    else await removeTempDirectory(directory);
  }
}

/**
 * Shared pick and compressed-byte gate for user-selected images. The caller
 * chooses the bounded decoder appropriate to its image class.
 */
async function pickImageFile(options: {
  title: string;
  maxBytes: number;
  sizeError: string;
}): Promise<PickedImageFile> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: options.title,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { success: false, error: 'Cancelled' };

  const selectedFile = filePaths[0];
  const fileStat = await stat(selectedFile);
  if (fileStat.size > options.maxBytes) {
    return { success: false, error: options.sizeError };
  }

  return { success: true, buffer: await readFile(selectedFile), filePath: selectedFile };
}

/** Decode and width-cap alert images through Electron's PNG/JPEG-only image API. */
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

const ALLOWED_EXTERNAL_HOSTS = new Set([
  ...Object.values(CLOUD_STATUS_PROVIDERS).map((provider) =>
    new URL(provider.statusUrl).hostname.toLowerCase(),
  ),
  'stspg.io',
  'statuspage.io',
  'x.com',
  'twitter.com',
  'downdetector.com',
  new URL(RADAR_URL).hostname.toLowerCase(),
]);
const MAX_EXTERNAL_URL_LENGTH = 2_081;
const MAX_TEAMS_SUBJECT_LENGTH = 200;
const MAX_TEAMS_ATTENDEE_COUNT = 100;
const MAX_EMAIL_LENGTH = 254;
const TEAMS_HOSTNAME = 'teams.microsoft.com';
const TEAMS_MEETING_PATHNAME = '/l/meeting/new';
const TEAMS_MEETING_QUERY_KEYS = new Set(['attendees', 'subject']);
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

function isBoundedSimpleEmail(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_EMAIL_LENGTH ||
    value.includes(',') ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    [...value].some((character) => character.trim() === '')
  ) {
    return false;
  }
  const at = value.indexOf('@');
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return at > 0 && at === value.lastIndexOf('@') && dot > 0 && dot < domain.length - 1;
}

function normalizeAllowedTeamsMeetingUrl(parsed: URL, canonicalUrl: string): string | null {
  if (
    parsed.hostname.toLowerCase() !== TEAMS_HOSTNAME ||
    parsed.pathname !== TEAMS_MEETING_PATHNAME ||
    parsed.hash
  ) {
    return null;
  }

  const queryKeys = [...parsed.searchParams.keys()];
  if (
    queryKeys.length !== TEAMS_MEETING_QUERY_KEYS.size ||
    queryKeys.some(
      (key) => !TEAMS_MEETING_QUERY_KEYS.has(key) || parsed.searchParams.getAll(key).length !== 1,
    )
  ) {
    return null;
  }

  const subject = parsed.searchParams.get('subject');
  const attendees = parsed.searchParams.get('attendees');
  if (
    subject === null ||
    attendees === null ||
    subject.length === 0 ||
    subject.length > MAX_TEAMS_SUBJECT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(subject) ||
    CONTROL_CHARACTER_PATTERN.test(attendees)
  ) {
    return null;
  }

  const attendeeEmails = attendees === '' ? [] : attendees.split(',');
  if (
    attendeeEmails.length > MAX_TEAMS_ATTENDEE_COUNT ||
    attendeeEmails.some((email) => !isBoundedSimpleEmail(email))
  ) {
    return null;
  }
  return canonicalUrl;
}

function normalizeAllowedExternalUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_EXTERNAL_URL_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const canonicalUrl = parsed.toString();
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      CONTROL_CHARACTER_PATTERN.test(canonicalUrl)
    ) {
      return null;
    }

    if (parsed.protocol === 'msteams:') {
      return normalizeAllowedTeamsMeetingUrl(parsed, canonicalUrl);
    }
    if (parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === TEAMS_HOSTNAME) {
      return normalizeAllowedTeamsMeetingUrl(parsed, canonicalUrl);
    }
    if (isDynatraceHost(hostname) || ALLOWED_EXTERNAL_HOSTS.has(hostname)) return canonicalUrl;
    return null;
  } catch {
    return null;
  }
}

export function setupWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  getDataRoot?: () => Promise<string>,
) {
  const brandAssets = getDataRoot ? new BrandAssetService(getDataRoot) : null;
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (event, url: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OPEN_EXTERNAL)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (shouldSuppressDesktopSideEffects()) return normalizeAllowedExternalUrl(url) !== null;
    try {
      const normalizedUrl = normalizeAllowedExternalUrl(url);
      if (normalizedUrl) {
        await shell.openExternal(normalizedUrl);
        return true;
      }
      loggers.security.error(`Blocked opening external URL: ${describeUrlForLog(url)}`);
      return false;
    } catch {
      loggers.security.error(`Invalid URL provided to openExternal: ${describeUrlForLog(url)}`);
      return false;
    }
  });

  // Schedule Bridge (.ics) — write the invite to a temp file and open it with
  // the default calendar handler so the user can review and send it.
  ipcMain.handle(IPC_CHANNELS.ICS_SAVE_AND_OPEN, async (event, content: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ICS_SAVE_AND_OPEN)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (typeof content !== 'string' || content.length === 0 || content.length >= MAX_ICS_LENGTH) {
      loggers.security.error('Blocked saving invalid ICS content');
      return false;
    }
    try {
      // shell.openPath never rejects; it resolves with a non-empty error string on failure
      const openError = await openThroughPrivateTempFile('relay-bridge.ics', content, (filePath) =>
        shell.openPath(filePath),
      );
      if (openError) {
        loggers.ipc.warn('ICS open failed', { error: openError });
        return false;
      }
      return true;
    } catch (err) {
      loggers.ipc.warn('ICS save and open failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  // Outlook alert draft (.eml) — X-Unsent opens an editable message while the
  // CID image and its explicit dimensions remain under Relay's control.
  ipcMain.handle(IPC_CHANNELS.ALERT_DRAFT_SAVE_AND_OPEN, async (event, content: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_DRAFT_SAVE_AND_OPEN)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (
      typeof content !== 'string' ||
      content.length === 0 ||
      content.length >= MAX_ALERT_DRAFT_EML_LENGTH ||
      !content.includes('X-Unsent: 1') ||
      !content.includes('Content-Type: multipart/related;') ||
      !content.includes('Content-ID: <relay-alert-image>')
    ) {
      loggers.security.error('Blocked saving invalid alert draft EML content');
      return false;
    }
    try {
      const openError = await openThroughPrivateTempFile(
        'relay-alert.eml',
        content,
        openAlertDraftFile,
      );
      if (openError) {
        loggers.ipc.warn('Alert draft open failed', { error: openError });
        return false;
      }
      return true;
    } catch (err) {
      loggers.ipc.warn('Alert draft save and open failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ALERT_PLAY_SOUND, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_PLAY_SOUND)) return false;
    try {
      shell.beep();
      return true;
    } catch (err) {
      loggers.ipc.warn('Alert sound failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

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
      if (canceled || !filePath) {
        return { success: false, error: 'Cancelled' };
      }
      if (extname(filePath).toLowerCase() !== '.mp3') {
        return { success: false, error: 'Select an MP3 file' };
      }
      return { success: true, data: pathToFileURL(filePath).href };
    } catch (err) {
      loggers.ipc.warn('Reminder sound selection failed', {
        error: getErrorMessage(err),
      });
      return { success: false, error: err instanceof Error ? err.message : 'Selection failed' };
    }
  });

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

      // JPEG has no alpha channel — keep PNG sources as PNG so transparent
      // backgrounds survive instead of compositing to black.
      if (extname(picked.filePath).toLowerCase() === '.png') {
        return {
          success: true,
          data: 'data:image/png;base64,' + picked.image.toPNG().toString('base64'),
        };
      }
      return {
        success: true,
        data: 'data:image/jpeg;base64,' + picked.image.toJPEG(82).toString('base64'),
      };
    } catch (err) {
      loggers.ipc.warn('Alert body image selection failed', {
        error: getErrorMessage(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Image selection failed',
      };
    }
  });

  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MINIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  // Drag Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.DRAG_STARTED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STARTED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STARTED);
  });

  ipcMain.on(IPC_CHANNELS.DRAG_STOPPED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STOPPED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STOPPED);
  });

  // On-Call Alert Dismissal Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, (event, type: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ONCALL_ALERT_DISMISSED)) return;
    broadcastToAllWindows(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, type);
  });

  // Clipboard - use Electron's native clipboard API
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (event, text: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CLIPBOARD_WRITE)) return false;
    try {
      if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_LENGTH) {
        return false;
      }
      clipboard.writeText(text);
      return true;
    } catch (err) {
      loggers.ipc.warn('Clipboard write failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

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

      // Lazy-load sharp: its platform-native binary may be missing (packaging
      // gaps, --omit=optional installs), and optimization is best-effort — the
      // renderer falls back to the unoptimized capture. An eager import here
      // would take the whole main process down at startup instead.
      const { default: sharp } = await import('sharp');
      const optimizedBuffer = await sharp(sourceBuffer)
        .withMetadata({ density: 96 })
        .png({
          adaptiveFiltering: true,
          compressionLevel: 9,
          effort: 10,
        })
        .toBuffer();

      const optimizedDataUrl = PNG_DATA_URL_PREFIX + optimizedBuffer.toString('base64');
      if (optimizedDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return { success: false, error: 'Prepared image exceeds size limit' };
      }

      return {
        success: true,
        data: optimizedDataUrl,
      };
    } catch (err) {
      loggers.ipc.warn('Alert image optimization failed', {
        error: getErrorMessage(err),
      });
      return { success: false, error: 'Optimization failed' };
    }
  });

  // Save Alert Image - native save dialog + write PNG to disk
  ipcMain.handle(
    IPC_CHANNELS.SAVE_ALERT_IMAGE,
    async (event, dataUrl: string, suggestedName: string) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.SAVE_ALERT_IMAGE)) {
        return { success: false, error: 'Untrusted sender' };
      }
      try {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
          return { success: false, error: 'Invalid image data' };
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
          return { success: false, error: 'Image data exceeds size limit' };
        }
        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) {
          return { success: false, error: 'Invalid image data' };
        }
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: sanitizePngSuggestedName(suggestedName),
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (canceled || !filePath) {
          return { success: false, error: 'Cancelled' };
        }
        await writeFile(filePath, image.toPNG());
        return { success: true, data: filePath };
      } catch (err) {
        loggers.ipc.warn('Alert image save failed', {
          error: getErrorMessage(err),
        });
        return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
      }
    },
  );

  // Logo handlers — factory for save/get/remove pattern
  function createLogoHandlers(
    kind: 'company' | 'footer',
    dialogTitle: string,
    channels: { save: string; get: string; remove: string },
  ): void {
    ipcMain.handle(channels.save, async (event) => {
      if (!assertTrustedIpcSender(event, channels.save)) {
        return { success: false, error: 'Untrusted sender' };
      }
      if (!brandAssets) return { success: false, error: 'Data root not available' };
      try {
        const picked = await pickImageFile({
          title: dialogTitle,
          maxBytes: MAX_LOGO_SIZE,
          sizeError: 'Image must be under 2MB',
        });
        if (!picked.success) return picked;

        return await brandAssets.savePng(kind, picked.buffer);
      } catch (err) {
        loggers.ipc.warn(`${dialogTitle} save failed`, {
          error: getErrorMessage(err),
        });
        return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
      }
    });

    ipcMain.handle(channels.get, async (event) => {
      if (!assertTrustedIpcSender(event, channels.get)) return null;
      return (await brandAssets?.get(kind)) ?? null;
    });

    ipcMain.handle(channels.remove, async (event) => {
      if (!assertTrustedIpcSender(event, channels.remove)) {
        return { success: false, error: 'Untrusted sender' };
      }
      if (!brandAssets) return { success: false, error: 'Data root not available' };
      return await brandAssets.remove(kind);
    });
  }

  createLogoHandlers('company', 'Select Company Logo', {
    save: IPC_CHANNELS.SAVE_COMPANY_LOGO,
    get: IPC_CHANNELS.GET_COMPANY_LOGO,
    remove: IPC_CHANNELS.REMOVE_COMPANY_LOGO,
  });

  createLogoHandlers('footer', 'Select Footer Logo', {
    save: IPC_CHANNELS.SAVE_FOOTER_LOGO,
    get: IPC_CHANNELS.GET_FOOTER_LOGO,
    remove: IPC_CHANNELS.REMOVE_FOOTER_LOGO,
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MAXIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_CLOSE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    loggers.main.info('Window close requested by renderer', {
      webContentsId: event.sender.id,
    });
    win?.close();
  });

  // Maximize state query
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_IS_MAXIMIZED)) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  // Listen for maximize/unmaximize events and notify renderer
  // Note: This needs to be called when window is created, but here we just setup the IPCs.
  // The event listeners on the window itself should be attached where the window is created or managed.
  // HOWEVER, the original code attached them inside setupIpcHandlers which had access to getMainWindow().
  // We can't attach listeners to the window instance here easily if it changes or isn't created yet,
  // but if getMainWindow returns the current instance, we can try.
  // A better pattern might be to let the main process setup these listeners on window creation.
  // For now, we'll keep the IPCs here. The window event listeners (maximize/unmaximize)
  // were in the body of setupIpcHandlers. We'll export a helper for that too.
}

export function setupWindowListeners(window: BrowserWindow) {
  window.on('maximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, true);
  });
  window.on('unmaximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, false);
  });
}
