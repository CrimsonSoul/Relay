import {
  MIST_CLOUD_STATUS_PROVIDER_ORDER,
  type CloudStatusItem,
  type CloudStatusSeverity,
  type MistCloudStatusData,
  type MistCloudStatusProvider,
} from '@shared/ipc';
import { emptyMistCloudStatusProviders } from '@shared/cloudStatus';
import { loggers } from '../../logger';
import { truncateError } from '../ipcHelpers';
import { fetchNoStore } from './fetchNoStore';
import type {
  SorryAppComponent,
  SorryAppNoticeDetail,
  SorryAppNoticeSummary,
  SorryAppNoticeUpdate,
} from './types';

export const MIST_STATUS_URL = 'https://status.mist.com/';
export const MIST_NOTICES_URL =
  'https://status.mist.com/api/v1/notices?filter%5Btimeline_state_eq%5D=present&filter%5Btype_eq%5D=unplanned';
export const MIST_COMPONENTS_URL = 'https://status.mist.com/api/v1/components';

export type MistProviderFetchResult = {
  providers: MistCloudStatusData['providers'];
  errors: MistCloudStatusData['errors'];
};

const MIST_COMPONENT_PROVIDER = new Map<string, MistCloudStatusProvider>([
  ['24585', 'mist_global'],
  ['24592', 'mist_emea'],
  ['84051', 'mist_apac'],
  ['84052', 'mist_federal'],
]);

const MIST_COMPONENT_NAME_PROVIDER: Record<string, MistCloudStatusProvider> = {
  'MIST GLOBAL CLOUD': 'mist_global',
  'MIST EMEA CLOUD': 'mist_emea',
  'MIST APAC CLOUD': 'mist_apac',
  'MIST FEDERAL CLOUD': 'mist_federal',
};

const JSON_REQUEST = {
  headers: { Accept: 'application/json' },
  redirect: 'follow' as const,
};

export function mistNoticeStateToSeverity(state: string): CloudStatusSeverity | null {
  switch (normalizeState(state)) {
    case 'investigating':
    case 'identified':
      return 'error';
    case 'recovering':
      return 'warning';
    default:
      return null;
  }
}

export async function fetchMistProviderGroup(
  now: () => number = Date.now,
): Promise<MistProviderFetchResult> {
  const providers = emptyMistCloudStatusProviders();
  const errors: MistCloudStatusData['errors'] = [];
  const [noticesResult, componentsResult] = await Promise.allSettled([
    fetchMistNotices(),
    fetchMistComponents(),
  ]);

  if (noticesResult.status === 'rejected') throw noticesResult.reason;

  const notices = noticesResult.value.filter(isActiveUnplannedNotice);
  const providersWithNotices = await appendActiveNotices(providers, notices);
  const components = appendComponentCoverageErrors(componentsResult, errors);
  appendComponentWarnings(providers, components, providersWithNotices, now());

  return { providers, errors };
}

async function appendActiveNotices(
  providers: MistCloudStatusData['providers'],
  notices: readonly SorryAppNoticeSummary[],
): Promise<Set<MistCloudStatusProvider>> {
  const detailResults = await Promise.allSettled(
    notices.map((summary) => fetchMistNoticeDetail(summary.id)),
  );
  const providersWithNotices = new Set<MistCloudStatusProvider>();

  for (let index = 0; index < notices.length; index += 1) {
    const summary = notices[index]!;
    const detailResult = detailResults[index]!;
    if (detailResult.status === 'rejected') {
      loggers.cloudStatus.warn('Mist notice detail unavailable', {
        noticeId: String(summary.id),
        error: truncateError(detailResult.reason),
      });
    }
    const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;
    const source = detail ?? summary;
    const severity = mistNoticeStateToSeverity(source.state);
    if (!severity) continue;

    const affectedProviders = detail
      ? providersForComponents(detail.components)
      : allMistProviders();
    const update = newestUpdate(detail?.updates ?? []) ?? source.latest_update;
    const baseItem = {
      id: String(source.id),
      title: source.subject,
      description: update?.content ?? '',
      pubDate: update?.created_at ?? source.began_at,
      link: trustedMistNoticeUrl(source.url),
      severity,
    } satisfies Omit<CloudStatusItem, 'provider'>;

    for (const provider of affectedProviders) {
      providers[provider].push({ ...baseItem, provider });
      providersWithNotices.add(provider);
    }
  }

  return providersWithNotices;
}

function appendComponentCoverageErrors(
  result: PromiseSettledResult<SorryAppComponent[]>,
  errors: MistCloudStatusData['errors'],
): SorryAppComponent[] {
  if (result.status === 'fulfilled') return result.value;

  const message = `Juniper Mist component status is unavailable: ${truncateError(result.reason)}`;
  for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
    errors.push({ provider, message });
  }
  return [];
}

function appendComponentWarnings(
  providers: MistCloudStatusData['providers'],
  components: readonly SorryAppComponent[],
  providersWithNotices: ReadonlySet<MistCloudStatusProvider>,
  timestamp: number,
): void {
  for (const component of components) {
    const provider = providerForComponent(component);
    if (!provider || normalizeState(component.state) !== 'degraded') continue;
    if (providersWithNotices.has(provider)) continue;

    providers[provider].push({
      id: `mist-component-${component.id}`,
      provider,
      title: `${component.name} is degraded`,
      description: `Juniper Mist reports degraded service for ${component.name}.`,
      pubDate: new Date(timestamp).toISOString(),
      link: MIST_STATUS_URL,
      severity: 'warning',
    });
  }
}

async function fetchMistNotices(): Promise<SorryAppNoticeSummary[]> {
  const body = await fetchJson(MIST_NOTICES_URL);
  if (!isRecord(body) || !Array.isArray(body.notices)) {
    throw new Error('Invalid Mist notices response');
  }
  return body.notices.map(parseNoticeSummary).filter(isPresent);
}

async function fetchMistComponents(): Promise<SorryAppComponent[]> {
  const body = await fetchJson(MIST_COMPONENTS_URL);
  if (!isRecord(body) || !Array.isArray(body.components)) {
    throw new Error('Invalid Mist components response');
  }
  return body.components.map(parseComponent).filter(isPresent);
}

async function fetchMistNoticeDetail(
  id: SorryAppNoticeSummary['id'],
): Promise<SorryAppNoticeDetail> {
  const body = await fetchJson(
    `${MIST_STATUS_URL}api/v1/notices/${encodeURIComponent(String(id))}`,
  );
  if (!isRecord(body)) throw new Error('Invalid Mist notice detail response');
  const detail = parseNoticeDetail(body.notice);
  if (!detail) throw new Error('Invalid Mist notice detail response');
  return detail;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchNoStore(url, {
    ...JSON_REQUEST,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function parseNoticeSummary(value: unknown): SorryAppNoticeSummary | null {
  if (!isRecord(value)) return null;
  const id = boundedId(value.id);
  const type = boundedString(value.type, 64);
  const state = boundedString(value.state, 64);
  const timelineState = boundedString(value.timeline_state, 64);
  const subject = boundedString(value.subject, 2_000);
  const url = boundedString(value.url, 2_048);
  const beganAt = timestampString(value.began_at);
  if (id === null || !type || !state || !timelineState || !subject || !url || !beganAt) {
    return null;
  }

  return {
    id,
    type,
    state,
    timeline_state: timelineState,
    subject,
    url,
    began_at: beganAt,
    latest_update: value.latest_update ? parseNoticeUpdate(value.latest_update) : null,
  };
}

function parseNoticeDetail(value: unknown): SorryAppNoticeDetail | null {
  const summary = parseNoticeSummary(value);
  if (!summary || !isRecord(value) || !Array.isArray(value.components)) return null;
  if (!Array.isArray(value.updates)) return null;
  return {
    ...summary,
    components: value.components.map(parseComponent).filter(isPresent),
    updates: value.updates.map(parseNoticeUpdate).filter(isPresent),
  };
}

function parseNoticeUpdate(value: unknown): SorryAppNoticeUpdate | null {
  if (!isRecord(value)) return null;
  const state = boundedString(value.state, 64);
  const content = boundedString(value.content, 20_000, true);
  const createdAt = timestampString(value.created_at);
  if (!state || content === null || !createdAt) return null;
  return { state, content, created_at: createdAt };
}

function parseComponent(value: unknown): SorryAppComponent | null {
  if (!isRecord(value)) return null;
  const id = boundedId(value.id);
  const name = boundedString(value.name, 1_000);
  const state = boundedString(value.state, 64);
  const updatedAt = timestampString(value.updated_at);
  if (id === null || !name || !state || !updatedAt) return null;
  return { id, name, state, updated_at: updatedAt };
}

function isActiveUnplannedNotice(notice: SorryAppNoticeSummary): boolean {
  return (
    normalizeState(notice.type) === 'unplanned' &&
    normalizeState(notice.timeline_state) === 'present' &&
    mistNoticeStateToSeverity(notice.state) !== null
  );
}

function providersForComponents(
  components: readonly SorryAppComponent[],
): MistCloudStatusProvider[] {
  const providers = new Set<MistCloudStatusProvider>();
  for (const component of components) {
    const provider = providerForComponent(component);
    if (provider) providers.add(provider);
  }
  return providers.size > 0 ? [...providers] : allMistProviders();
}

function providerForComponent(component: SorryAppComponent): MistCloudStatusProvider | undefined {
  return (
    MIST_COMPONENT_PROVIDER.get(String(component.id)) ??
    MIST_COMPONENT_NAME_PROVIDER[component.name.trim().toUpperCase()]
  );
}

function allMistProviders(): MistCloudStatusProvider[] {
  return [...MIST_CLOUD_STATUS_PROVIDER_ORDER];
}

function newestUpdate(updates: readonly SorryAppNoticeUpdate[]): SorryAppNoticeUpdate | undefined {
  return [...updates].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  )[0];
}

function trustedMistNoticeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'status.mist.com'
      ? url.toString()
      : MIST_STATUS_URL;
  } catch {
    return MIST_STATUS_URL;
  }
}

function normalizeState(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[-\s]+/g, '_');
}

function boundedId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return boundedString(value, 512);
}

function timestampString(value: unknown): string | null {
  const timestamp = boundedString(value, 100);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  if (!allowEmpty && value.length === 0) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
