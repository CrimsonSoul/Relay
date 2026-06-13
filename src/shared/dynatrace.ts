export type DynatraceRuntimeState =
  | 'live'
  | 'authenticating'
  | 'blocked'
  | 'load-failed'
  | 'closed';

export type DynatraceNavigationKind = 'dynatrace' | 'microsoft-auth' | 'blocked';

export type DynatraceDashboardBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type DynatraceDashboard = {
  id: string;
  name: string;
  url: string;
  bounds?: DynatraceDashboardBounds;
};

export type DynatraceDashboardState = DynatraceDashboard & {
  state: DynatraceRuntimeState;
  lastUrl?: string;
  error?: string;
};

export type DynatraceDashboardInput = {
  name: string;
  url: string;
};

const MICROSOFT_AUTH_HOSTS = new Set([
  'login.microsoft.com',
  'login.microsoftonline.com',
  'login.windows.net',
  'sts.windows.net',
]);

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function isDynatraceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'dynatrace.com' || host.endsWith('.dynatrace.com');
}

export function isMicrosoftAuthHost(hostname: string): boolean {
  return MICROSOFT_AUTH_HOSTS.has(hostname.toLowerCase());
}

export function getDynatraceStartUrlError(value: string): string | null {
  const parsed = parseHttpUrl(value);
  if (!parsed) return 'Enter a valid URL.';
  if (parsed.protocol !== 'https:') return 'Dynatrace dashboard URLs must use HTTPS.';
  if (!isDynatraceHost(parsed.hostname)) return 'Enter a Dynatrace URL under dynatrace.com.';
  return null;
}

export function classifyDynatraceNavigation(value: string): DynatraceNavigationKind {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return 'blocked';
  if (isDynatraceHost(parsed.hostname)) return 'dynatrace';
  if (isMicrosoftAuthHost(parsed.hostname)) return 'microsoft-auth';
  return 'blocked';
}

export function isDynatraceAuthUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (!parsed || !isDynatraceHost(parsed.hostname)) return false;
  const authText = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  return (
    authText.includes('signin') ||
    authText.includes('sign-in') ||
    authText.includes('login') ||
    authText.includes('/sso') ||
    authText.includes('oauth')
  );
}
