import type { CloudStatusItem, CloudStatusSeverity } from '@shared/ipc';
import { fetchNoStore } from './fetchNoStore';

const DYNATRACE_STATUS_API_URL = 'https://api.status.io/1.0/status/546d8cb6af8407b6730000cb';
const DYNATRACE_STATUS_URL = 'https://dynatrace.status.io/';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INCIDENTS = 100;
const MAX_MESSAGES_PER_INCIDENT = 100;
const MAX_AFFECTED_SCOPES = 100;
const ACTIVE_ISSUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAINTENANCE_NOTICE_PATTERN =
  /\b(?:planned|scheduled)\b[\s:-]*(?:\w+[\s:-]+){0,4}maintenance\b/iu;
const SECURITY_NOTICE_PATTERN = /\b(?:security advisory|vulnerability|cve-\d{4}-\d+)\b/iu;

type StatusIoMessage = {
  details: string;
  status: number;
  datetime: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function titleCaseWords(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function normalizeAffectedScope(value: string): string {
  const match = /^(?:Process|Retain)-([^-]+)-(.+)$/u.exec(value);
  if (!match) return value;
  return `${match[1]!.toUpperCase()} · ${titleCaseWords(match[2]!)}`;
}

function severityForStatusCode(status: number): CloudStatusSeverity | null {
  if (status === 300) return 'warning';
  if (status === 400 || status === 500) return 'error';
  return null;
}

function isNonAvailabilityNotice(title: string): boolean {
  return MAINTENANCE_NOTICE_PATTERN.test(title) || SECURITY_NOTICE_PATTERN.test(title);
}

function isStatusIoMessage(value: unknown): value is StatusIoMessage {
  return (
    isRecord(value) &&
    isBoundedString(value.datetime, 100) &&
    isBoundedString(value.details, 20_000) &&
    typeof value.status === 'number'
  );
}

function latestMessage(messages: unknown[]): StatusIoMessage | null {
  return (
    messages
      .filter(isStatusIoMessage)
      .toSorted((left, right) => Date.parse(right.datetime) - Date.parse(left.datetime))[0] ?? null
  );
}

function affectedScopes(candidate: Record<string, unknown>): string[] | null {
  const rawScopes = Array.isArray(candidate.containers_affected)
    ? candidate.containers_affected
    : [];
  const hasOversizedScope = rawScopes.some(
    (scope) => isRecord(scope) && typeof scope.name === 'string' && scope.name.length > 200,
  );
  if (hasOversizedScope) return null;
  return rawScopes.flatMap((scope) =>
    isRecord(scope) && isBoundedString(scope.name, 200) ? [normalizeAffectedScope(scope.name)] : [],
  );
}

function parseIncident(candidate: unknown, now: number): CloudStatusItem<'dynatrace'> | null {
  if (
    !isRecord(candidate) ||
    candidate.current_active !== true ||
    !isBoundedString(candidate._id, 512) ||
    !isBoundedString(candidate.name, 2_000) ||
    !Array.isArray(candidate.messages)
  ) {
    return null;
  }
  if (candidate.messages.length > MAX_MESSAGES_PER_INCIDENT) {
    throw new Error('Invalid Dynatrace Status.io response');
  }
  if (
    Array.isArray(candidate.containers_affected) &&
    candidate.containers_affected.length > MAX_AFFECTED_SCOPES
  ) {
    throw new Error('Invalid Dynatrace Status.io response');
  }

  const latest = latestMessage(candidate.messages);
  if (!latest) return null;
  const severity = severityForStatusCode(latest.status);
  const publishedAt = Date.parse(latest.datetime);
  if (
    !severity ||
    !Number.isFinite(publishedAt) ||
    now - publishedAt > ACTIVE_ISSUE_WINDOW_MS ||
    isNonAvailabilityNotice(candidate.name)
  ) {
    return null;
  }
  const scopes = affectedScopes(candidate);
  if (!scopes) return null;

  return {
    id: candidate._id,
    provider: 'dynatrace',
    title: candidate.name,
    description: latest.details,
    pubDate: latest.datetime,
    link: DYNATRACE_STATUS_URL,
    severity,
    affectedScopes: scopes,
  };
}

function parseResponseBody(responseBody: string): unknown {
  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    throw new Error('Invalid Dynatrace Status.io response');
  }
}

function incidentsFromBody(body: unknown): unknown[] {
  if (
    !isRecord(body) ||
    !isRecord(body.result) ||
    !Array.isArray(body.result.incidents) ||
    body.result.incidents.length > MAX_INCIDENTS
  ) {
    throw new Error('Invalid Dynatrace Status.io response');
  }
  return body.result.incidents;
}

export async function fetchDynatraceStatusProvider(
  _now = Date.now(),
): Promise<CloudStatusItem<'dynatrace'>[]> {
  const response = await fetchNoStore(DYNATRACE_STATUS_API_URL, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from Dynatrace Status.io`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Dynatrace Status.io response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }

  const responseBody = await response.text();
  if (Buffer.byteLength(responseBody, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`Dynatrace Status.io response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return incidentsFromBody(parseResponseBody(responseBody)).flatMap((candidate) => {
    const item = parseIncident(candidate, _now);
    return item ? [item] : [];
  });
}
