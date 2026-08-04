import { ipcMain, shell } from 'electron';
import { CLOUD_STATUS_PROVIDERS, IPC_CHANNELS } from '@shared/ipc';
import { isDynatraceHost } from '@shared/dynatrace';
import { RADAR_URL } from '@shared/radar';
import { describeUrlForLog } from '@shared/urlSecurity';
import { loggers } from '../../logger';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { rateLimiters } from '../../rateLimiter';
import { shouldSuppressDesktopSideEffects } from '../../app/e2eSafety';

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

export function registerOpenExternalHandler(): void {
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (event, url: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OPEN_EXTERNAL)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (shouldSuppressDesktopSideEffects()) return normalizeAllowedExternalUrl(url) !== null;
    try {
      const normalizedUrl = normalizeAllowedExternalUrl(url);
      if (normalizedUrl) {
        await shell.openExternal(normalizedUrl); // NOSONAR - protocol, host, credentials, port, path, and query are allowlisted above.
        return true;
      }
      loggers.security.error(`Blocked opening external URL: ${describeUrlForLog(url)}`);
      return false;
    } catch {
      loggers.security.error(`Invalid URL provided to openExternal: ${describeUrlForLog(url)}`);
      return false;
    }
  });
}
