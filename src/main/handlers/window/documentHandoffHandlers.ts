import { app, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IPC_CHANNELS, MAX_ALERT_DRAFT_EML_LENGTH } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../../logger';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { rateLimiters } from '../../rateLimiter';
import { OUTLOOK_DRAFT_SCRIPT, outlookDraftFromEml } from './outlookDraftScript';

const MAX_ICS_LENGTH = 1_048_576;
const MAC_OPEN_COMMAND = '/usr/bin/open';
const MAC_OSASCRIPT_COMMAND = '/usr/bin/osascript';
// Long enough for the first-run "Relay wants to control Microsoft Outlook" prompt.
const OUTLOOK_SCRIPT_TIMEOUT_MS = 120_000;

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

function runOutlookDraftScript(htmlPath: string, subject: string): Promise<string> {
  return new Promise((resolveScript) => {
    execFile(
      MAC_OSASCRIPT_COMMAND,
      // htmlPath is absolute, so osascript treats it and the subject as script arguments, never options.
      ['-e', OUTLOOK_DRAFT_SCRIPT, htmlPath, subject],
      { timeout: OUTLOOK_SCRIPT_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        resolveScript(error ? execOutputText(stderr) || getErrorMessage(error) : '');
      },
    );
  });
}

/**
 * New Outlook for Mac opens an .eml read-only, so macOS creates the draft through Outlook's
 * AppleScript and opens the .eml only when that fails (no Outlook, or automation not allowed).
 */
async function openMacAlertDraft(filePath: string, eml: string): Promise<string> {
  const draft = outlookDraftFromEml(eml);
  if (draft) {
    const htmlPath = join(dirname(filePath), 'relay-alert.html');
    await writeFile(htmlPath, draft.html, { encoding: 'utf8', mode: 0o600 });
    const scriptError = await runOutlookDraftScript(htmlPath, draft.subject);
    if (!scriptError) return '';
    loggers.ipc.warn('Outlook draft script failed; opening the EML instead', {
      error: scriptError,
    });
  }
  return openMacOutlookDraft(filePath);
}

function openAlertDraftFile(filePath: string, eml: string): Promise<string> {
  if (process.platform === 'darwin') return openMacAlertDraft(filePath, eml);
  return shell.openPath(filePath);
}

// A successful handoff is removed on the next call so a cold-starting helper
// application has unbounded time to read it while residue stays bounded.
let handedOffTempDirectories: string[] = [];

async function removeTempDirectory(directory: string): Promise<void> {
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
    if (handedOff) handedOffTempDirectories.push(directory);
    else await removeTempDirectory(directory);
  }
}

export function registerIcsSaveAndOpenHandler(): void {
  ipcMain.handle(IPC_CHANNELS.ICS_SAVE_AND_OPEN, async (event, content: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ICS_SAVE_AND_OPEN)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (typeof content !== 'string' || content.length === 0 || content.length >= MAX_ICS_LENGTH) {
      loggers.security.error('Blocked saving invalid ICS content');
      return false;
    }
    try {
      const openError = await openThroughPrivateTempFile('relay-bridge.ics', content, (filePath) =>
        shell.openPath(filePath),
      );
      if (openError) {
        loggers.ipc.warn('ICS open failed', { error: openError });
        return false;
      }
      return true;
    } catch (err) {
      loggers.ipc.warn('ICS save and open failed', { error: getErrorMessage(err) });
      return false;
    }
  });
}

export function registerAlertDraftSaveAndOpenHandler(): void {
  ipcMain.handle(IPC_CHANNELS.ALERT_DRAFT_SAVE_AND_OPEN, async (event, content: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_DRAFT_SAVE_AND_OPEN)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (
      typeof content !== 'string' ||
      content.length === 0 ||
      content.length >= MAX_ALERT_DRAFT_EML_LENGTH ||
      !content.includes('X-Unsent: 1') ||
      !content.includes('Content-Type: multipart/related;') ||
      !content.includes('Content-Type: text/html')
    ) {
      loggers.security.error('Blocked saving invalid alert draft EML content');
      return false;
    }
    try {
      const openError = await openThroughPrivateTempFile('relay-alert.eml', content, (filePath) =>
        openAlertDraftFile(filePath, content),
      );
      if (openError) {
        loggers.ipc.warn('Alert draft open failed', { error: openError });
        return false;
      }
      return true;
    } catch (err) {
      loggers.ipc.warn('Alert draft save and open failed', { error: getErrorMessage(err) });
      return false;
    }
  });
}
