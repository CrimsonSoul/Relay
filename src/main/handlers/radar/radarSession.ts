import { session, type Session } from 'electron';
import { loggers } from '../../logger';
import { describeUrlForLog } from '@shared/urlSecurity';

/**
 * Radar sits behind the corporate SSO form, so the poller needs the cookie the
 * user established by signing in. Relay never handles those credentials: the
 * user completes the real form in a window bound to this partition, Chromium
 * stores the session cookie, and `Session.fetch` replays it. This mirrors how
 * the Dynatrace integration authenticates.
 */
export const RADAR_SESSION_PARTITION = 'persist:relay-radar';

export const RADAR_URL = 'https://cw-intra-web/CWDashboard/Home/Radar';

/** Anything the sign-in window is allowed to navigate to while completing SSO. */
export function isAllowedRadarUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(RADAR_URL).origin;
  } catch {
    return false;
  }
}

export function getRadarSession(): Session {
  const radarSession = session.fromPartition(RADAR_SESSION_PARTITION);
  hardenRadarSession(radarSession);
  return radarSession;
}

/**
 * The sign-in window renders a first-party intranet page, so it has no reason
 * to reach for camera, microphone, geolocation or notifications.
 */
function hardenRadarSession(radarSession: Session): void {
  radarSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    loggers.security.warn('Blocked Radar permission request', {
      permission,
      requestingOrigin: describeUrlForLog(details.requestingUrl),
    });
    callback(false);
  });

  radarSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    loggers.security.warn('Blocked Radar permission check', {
      permission,
      requestingOrigin: describeUrlForLog(requestingOrigin),
    });
    return false;
  });
}
