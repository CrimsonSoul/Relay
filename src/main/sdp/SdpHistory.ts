import { SdpHistorySchema, type SdpHistoryCommand, type SdpHistory } from '@shared/sdpHistory';
import { isObject, SdpProviderError, type SdpProvider } from './SdpProvider';
import { resourceHeaders } from './SdpResources';
const BASE = 'https://support.campingworld.com/app/itdesk/api/v3/requests';
function display(value: unknown): string {
  if (value === null || value === undefined || value === 'null') return '';
  if (Array.isArray(value)) return value.map(display).join(', ').slice(0, 12000);
  if (isObject(value)) return display(value.display_value ?? value.name ?? value.value ?? value.id);
  return String(value).slice(0, 12000);
}
/** Cloud sandbox contract: GET requests/{id}/_history, independently paginated. */
export async function readHistory(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: SdpHistoryCommand,
): Promise<SdpHistory> {
  const url = new URL(`${BASE}/${command.id}/_history`);
  url.searchParams.set(
    'input_data',
    JSON.stringify({
      list_info: {
        start_index: command.page * 50 + 1,
        row_count: 50,
        sort_field: 'time',
        sort_order: 'desc',
      },
    }),
  );
  const value = await provider.json(url.toString(), signal, { headers: resourceHeaders(token) });
  if (!isObject(value) || !Array.isArray(value.history)) throw new SdpProviderError('invalid');
  return SdpHistorySchema.parse({
    id: command.id,
    page: command.page,
    hasMore: isObject(value.list_info) && value.list_info.has_more_rows === true,
    entries: value.history.map((row) => {
      if (!isObject(row)) throw new SdpProviderError('invalid');
      const at = isObject(row.time) ? Number(row.time.value) : NaN;
      return {
        id: String(row.id),
        author: isObject(row.by) ? display(row.by.name).slice(0, 250) : '',
        at: Number.isFinite(at) && at >= 0 && at <= 8640000000000000 ? at : null,
        operation: display(row.operation).slice(0, 200),
        description: display(row.description),
        changes: (Array.isArray(row.diff) ? row.diff : []).map((change) => {
          if (!isObject(change)) throw new SdpProviderError('invalid');
          return {
            field: display(change.field).slice(0, 250),
            before: display(change.previous_value),
            after: display(change.current_value),
          };
        }),
      };
    }),
  });
}
