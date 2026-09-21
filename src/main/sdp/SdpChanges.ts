import {
  SDP_CHANGE_LOOKBACK_MS,
  SDP_CHANGE_GRACE_MS,
  SdpChangeRecordSchema,
  type SdpChangeRecord,
  SdpChangesPageSchema,
  type SdpChangesCommand,
  type SdpChangesPage,
} from '@shared/sdpChanges';
import { isObject, SdpProviderError, type SdpProvider } from './SdpProvider';
import { resourceHeaders } from './SdpResources';

function label(value: unknown, max = 200): string {
  if (isObject(value)) return label(value.display_value ?? value.name ?? value.value, max);
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
}
function time(value: unknown): number | null {
  if (!isObject(value) || value.value === null || value.value === '') return null;
  const result = Number(value.value);
  return Number.isSafeInteger(result) && result > 0 && result <= 8640000000000000 ? result : null;
}
function names(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 500) throw new SdpProviderError('invalid');
  return value.map((entry) => label(entry, 500)).filter(Boolean);
}
/** Account-bound, read-only projection; never persisted in snapshots or shared collections. */
export async function readChanges(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: SdpChangesCommand,
): Promise<SdpChangesPage> {
  const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/changes');
  url.searchParams.set(
    'input_data',
    JSON.stringify({
      list_info: {
        start_index: command.page * 50 + 1,
        row_count: 50,
        sort_field: 'scheduled_start_time',
        sort_order: 'desc',
        search_criteria: {
          field: 'scheduled_start_time',
          condition: 'greater or equal',
          value: String(Math.max(0, command.problemStart - SDP_CHANGE_LOOKBACK_MS)),
          children: [
            {
              field: 'scheduled_start_time',
              condition: 'lesser or equal',
              value: String(command.problemStart),
              logical_operator: 'AND',
            },
          ],
        },
      },
    }),
  );
  const value = await provider.json(url.toString(), signal, { headers: resourceHeaders(token) });
  if (
    !isObject(value) ||
    !Array.isArray(value.changes) ||
    !isObject(value.list_info) ||
    typeof value.list_info.has_more_rows !== 'boolean'
  )
    throw new SdpProviderError('invalid');
  const rawChanges = value.changes;
  const page = SdpChangesPageSchema.parse({
    page: command.page,
    hasMore: value.list_info.has_more_rows,
    detailsComplete: true,
    changes: rawChanges.map(project),
  });
  // Cloud list responses omit affected systems even with fields_required. Only hydrate
  // time-compatible records, in bounded batches; never silently report full coverage.
  const candidates = page.changes.filter((change, index) => {
    const raw = rawChanges[index];
    return (
      needsDetails(change, command.problemStart) &&
      isObject(raw) &&
      (!('assets' in raw) || !('services' in raw) || !('configuration_items' in raw))
    );
  });
  page.detailsComplete = candidates.length <= 10;
  const details = new Map<string, SdpChangeRecord>();
  for (let offset = 0; offset < Math.min(candidates.length, 10); offset += 3) {
    const batch = candidates.slice(offset, Math.min(offset + 3, 10));
    await Promise.all(
      batch.map(async (candidate) => {
        const response = await provider.json(
          `${url.origin}${url.pathname}/${candidate.id}`,
          signal,
          { headers: resourceHeaders(token) },
        );
        if (
          !isObject(response) ||
          !isObject(response.change) ||
          String(response.change.id) !== candidate.id
        )
          throw new SdpProviderError('invalid');
        if (
          !('assets' in response.change) ||
          !('services' in response.change) ||
          !('configuration_items' in response.change)
        )
          page.detailsComplete = false;
        details.set(candidate.id, project(response.change));
      }),
    );
  }
  page.changes = page.changes.map((change) => details.get(change.id) ?? change);
  return page;
}
function needsDetails(change: SdpChangeRecord, at: number): boolean {
  const start = change.scheduledStart;
  return (
    start !== null &&
    start <= at &&
    at - start <= SDP_CHANGE_LOOKBACK_MS &&
    at <= (change.scheduledEnd ?? start) + SDP_CHANGE_GRACE_MS &&
    (change.scheduledEnd === null || change.scheduledEnd >= start) &&
    !/\b(cancelled|canceled|rejected)\b/i.test(change.status)
  );
}
function project(row: unknown): SdpChangeRecord {
  if (!isObject(row)) throw new SdpProviderError('invalid');
  return SdpChangeRecordSchema.parse({
    id: String(row.id),
    number: label(row.display_id, 100) || String(row.id),
    title: label(row.title, 500),
    description: label(row.description, 20000),
    status: label(row.status),
    stage: label(row.stage),
    site: label(row.site),
    scheduledStart: time(row.scheduled_start_time),
    scheduledEnd: time(row.scheduled_end_time),
    assets: names(row.assets),
    services: names(row.services),
    configurationItems: names(row.configuration_items),
  });
}
