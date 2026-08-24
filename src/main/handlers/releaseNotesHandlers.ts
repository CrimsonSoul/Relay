import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { RelayReleaseNotes } from '@shared/releases';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';

export type ReleaseNotesProvider = {
  getCachedReleaseNotes: () => Promise<RelayReleaseNotes[]>;
  refreshReleaseNotes: () => Promise<RelayReleaseNotes[]>;
};

type GetReleaseNotesProvider = () => Promise<ReleaseNotesProvider>;

export async function getCachedReleaseNotes(
  event: IpcMainInvokeEvent,
  getProvider: GetReleaseNotesProvider,
): Promise<RelayReleaseNotes[]> {
  if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_RELEASE_NOTES_GET_CACHED)) return [];
  try {
    return await (await getProvider()).getCachedReleaseNotes();
  } catch (error) {
    loggers.main.warn('Cached Relay release notes unavailable', { error });
    return [];
  }
}

export async function refreshReleaseNotes(
  event: IpcMainInvokeEvent,
  getProvider: GetReleaseNotesProvider,
): Promise<IpcResult<RelayReleaseNotes[]>> {
  if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_RELEASE_NOTES_REFRESH)) {
    return { success: false, error: 'untrusted-sender' };
  }
  if (!rateLimiters.network.tryConsume().allowed) {
    return { success: false, error: 'rate-limited' };
  }
  try {
    return { success: true, data: await (await getProvider()).refreshReleaseNotes() };
  } catch (error) {
    loggers.main.warn('Relay release notes refresh unavailable', { error });
    return { success: false, error: 'unavailable' };
  }
}
