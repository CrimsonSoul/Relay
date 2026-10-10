import { emailConversationCriteria } from './SdpConversationQuery';
import { queueFilterCriteria, type SdpQueueFilters } from '@shared/sdpQueueFilters';
import {
  SDP_PAGE_SIZE,
  SdpAccountProfileSchema,
  type SdpAccountProfile,
  SdpDetailSchema,
  type SdpDetail,
  SdpQueuePageSchema,
  SDP_TEST_TICKET,
  SdpTicketSearchSchema,
  type SdpQueue,
  type SdpQueuePage,
  type SdpQueueTicket,
  type SdpQueueSort,
  type SdpQueueSortField,
  type SdpTestTicket,
  type SdpTicketSearch,
  sdpTicketDone,
} from '@shared/sdpAccount';
import { projectAttachments } from './SdpAttachments';
import { SDP_ATTACHMENT_MAX_BYTES } from '@shared/sdpAttachments';
import { loggers } from '../logger';
import { customFieldLabel, readCustomFieldCatalog } from './SdpFieldCatalog';
export const SDP_ACCOUNTS = 'https://accounts.zoho.com';
const FIELDS = ['id', 'display_id', 'status', 'priority', 'group', 'created_time', 'due_by_time'];
export class SdpProviderError extends Error {
  constructor(
    readonly kind: 'outage' | 'denied' | 'invalid' | 'throttled',
    readonly retryAfterMs = 0,
    readonly diagnostic?:
      | 'http'
      | 'response-size'
      | 'response-json'
      | 'queue-shape'
      | 'queue-fields'
      | 'queue-group'
      | 'queue-values'
      | 'label-value'
      | 'time-value'
      | 'rate-limit',
    readonly httpStatus?: number,
  ) {
    super('SDP request could not be completed.');
  }
}
export class SdpValidationError extends SdpProviderError {
  constructor(fields: string[]) {
    super('invalid', 0, 'http', 400);
    const detail = fields.length
      ? 'these fields: ' + fields.join(', ')
      : 'required fields and allowed values';
    this.message = `SDP rejected the change. Check ${detail}. Refresh the ticket before preparing a new change.`;
  }
}
export function validationFields(raw: unknown): string[] {
  const status = isObject(raw) && isObject(raw.response_status) ? raw.response_status : {};
  if (!Array.isArray(status.messages)) return [];
  return status.messages
    .flatMap((m: unknown) => {
      if (!isObject(m) || !Array.isArray(m.fields)) return [];
      return m.fields.filter(
        (f: unknown): f is string => typeof f === 'string' && /^[a-z][a-z0-9_.]{0,99}$/.test(f),
      );
    })
    .slice(0, 20);
}
function throttled(value = ''): SdpProviderError {
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return new SdpProviderError(
    'throttled',
    Number.isFinite(delay) ? Math.max(0, Math.min(delay, 3600000)) : 60000,
  );
}
/** Queue monitoring reads 100 tickets per request, the most SDP lists at once. */
const MONITOR_PAGE_SIZE = 100;
/** SDP's lockout after a rate limit (error 4015) is five minutes. */
const SDP_RATE_LIMIT_LOCK_MS = 300_000;
/** Whether an SDP error body reports error 4015, "API Rate Limit reached". */
function rateLimited(value: unknown): boolean {
  if (!isObject(value)) return false;
  const statuses = [value.response_status].flat().filter(isObject);
  return statuses.some(
    (status) =>
      status.status_code === 4015 ||
      [status.messages].flat().some((message) => isObject(message) && message.status_code === 4015),
  );
}
/**
 * The error for an HTTP 400 reply, which SDP sends both for its rate limit and for invalid input:
 * the body tells them apart.
 */
function badRequest(body: unknown, method = ''): Error {
  if (rateLimited(body))
    return new SdpProviderError('throttled', SDP_RATE_LIMIT_LOCK_MS, 'rate-limit');
  if (['POST', 'PUT', 'DELETE'].includes(method))
    return new SdpValidationError(validationFields(body));
  return new SdpProviderError('invalid', 0, 'http', 400);
}
function responseError(response: Response): SdpProviderError {
  if (response.status === 429) return throttled(response.headers.get('Retry-After') ?? undefined);
  if ([500, 502, 503, 504].includes(response.status)) return new SdpProviderError('outage');
  if ([401, 403, 404].includes(response.status))
    return new SdpProviderError('denied', 0, 'http', response.status);
  return new SdpProviderError('invalid', 0, 'http', response.status);
}
export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** Ignore malformed structured values instead of exposing object stringification in the UI. */
export function scalarText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}
export function projectTestTicket(value: unknown): SdpTestTicket {
  if (!isObject(value) || !Array.isArray(value.requests) || value.requests.length !== 1)
    throw new SdpProviderError('denied');
  const row: unknown = value.requests[0];
  if (
    !isObject(row) ||
    String(row.display_id) !== SDP_TEST_TICKET ||
    Object.keys(row).some((key) => !FIELDS.includes(key))
  )
    throw new SdpProviderError('invalid');
  const label = (field: unknown, fallback: string): string => {
    if (field == null) return fallback;
    if (
      !isObject(field) ||
      typeof field.name !== 'string' ||
      !field.name ||
      field.name.length > 200
    )
      throw new SdpProviderError('invalid');
    return field.name;
  };
  return {
    number: SDP_TEST_TICKET,
    status: label(row.status, 'Unknown'),
    priority: label(row.priority, 'Unspecified'),
    group: label(row.group, 'Unassigned'),
  };
}
/**
 * Runs `task` over `items` three at a time (as reply checks do), keeping input order. After a
 * failure no further item starts.
 */
async function mapBounded<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]!); // NOSONAR - each of the three workers runs one item at a time.
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return results;
}

const REQUEST_REPORT_MS = 60 * 60_000;
const MAX_REQUEST_KINDS = 64;
let requestWindowStart = Date.now();
let requestCounts = new Map<string, number>();
/**
 * Counts SDP calls by method and path, with IDs removed, and logs the totals once an hour so the
 * real call volume is visible. Counts only; no ticket IDs or contents are logged.
 */
export function countSdpRequest(url: string, method = 'GET', now = Date.now()): void {
  if (now - requestWindowStart >= REQUEST_REPORT_MS) {
    const byKind = Object.fromEntries(requestCounts);
    const total = [...requestCounts.values()].reduce((sum, count) => sum + count, 0);
    if (total > 0)
      loggers.main.info('SDP requests in the last hour', {
        total,
        minutes: Math.round((now - requestWindowStart) / 60_000),
        byKind,
      });
    requestWindowStart = now;
    requestCounts = new Map();
  }
  let path = 'other';
  try {
    path = new URL(url).pathname.replace(/^.*\/api\/v3\//u, '').replaceAll(/\d+/gu, ':id');
  } catch {
    // An unparsable URL fails in fetch; it still counts as a call.
  }
  let kind = `${method.toUpperCase()} ${path}`;
  if (!requestCounts.has(kind) && requestCounts.size >= MAX_REQUEST_KINDS) kind = 'other';
  requestCounts.set(kind, (requestCounts.get(kind) ?? 0) + 1);
}

/** How a queue page is filtered, sized and sorted; omitted parts read SDP's newest page. */
export type SdpQueueReadView = {
  filters?: SdpQueueFilters;
  pageSize?: number;
  sort?: SdpQueueSort;
};
/** One message in a ticket's conversation history. */
export type SdpConversation = SdpDetail['conversations'][number];
export class SdpProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async json(
    url: string,
    signal: AbortSignal,
    init: NonNullable<Parameters<typeof fetch>[1]> = {},
    maxBytes = 262144,
  ): Promise<unknown> {
    let response: Response;
    countSdpRequest(url, init.method);
    try {
      response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
    } catch (error) {
      if (signal.aborted) throw new SdpProviderError('invalid');
      const code = isObject(error) && isObject(error.cause) ? scalarText(error.cause.code) : '';
      const transient = [
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(code);
      if (transient || (error instanceof Error && error.name === 'TimeoutError'))
        throw new SdpProviderError('outage');
      // Redirect rejection, certificate failures, programming errors and unknown failures fail closed.
      throw new SdpProviderError('invalid');
    }
    if (!response.ok) {
      if (response.status === 400)
        throw badRequest(await this.readJson(response, maxBytes, signal), init.method);
      await response.body?.cancel();
      throw responseError(response);
    }
    return this.readJson(response, maxBytes, signal);
  }
  private async readJson(
    response: Response,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new SdpProviderError('invalid');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > Math.min(maxBytes, 1048576))
          throw new SdpProviderError('invalid', 0, 'response-size');
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof SdpProviderError) throw error;
      // The request deadline can expire mid-body; that is the same outage as a header timeout.
      if (!signal.aborted && error instanceof Error && error.name === 'TimeoutError')
        throw new SdpProviderError('outage');
      throw new SdpProviderError('invalid', 0, 'response-json');
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  async binary(
    url: string,
    signal: AbortSignal,
    init: NonNullable<Parameters<typeof fetch>[1]> = {},
    maxBytes = SDP_ATTACHMENT_MAX_BYTES,
  ): Promise<Buffer> {
    let response: Response;
    countSdpRequest(url, init.method);
    try {
      response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
    } catch {
      throw new SdpProviderError('outage');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 404].includes(response.status))
        throw new SdpProviderError('denied', 0, 'http', response.status);
      throw new SdpProviderError('invalid');
    }
    if (!response.body) throw new SdpProviderError('invalid');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) throw new SdpProviderError('invalid');
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  token(body: Record<string, string> | URLSearchParams, signal: AbortSignal): Promise<unknown> {
    return this.json(`${SDP_ACCOUNTS}/oauth/v2/token`, signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }
  async identity(
    token: string,
    signal: AbortSignal,
  ): Promise<{ id: string; profile?: SdpAccountProfile }> {
    const value = await this.json(`${SDP_ACCOUNTS}/oauth/user/info`, signal, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    // The verified immutable ID binds the sign-in; the name and email are only shown back to the person.
    const id = isObject(value) ? value.ZUID : undefined;
    if (
      !(typeof id === 'string' && /^\d{1,30}$/.test(id)) &&
      !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    )
      throw new SdpProviderError('invalid');
    return { id: String(id), profile: accountProfile(value as Record<string, unknown>) };
  }
  async queue(
    token: string,
    signal: AbortSignal,
    queue: SdpQueue,
    page: number,
    since?: number,
    view: SdpQueueReadView = {},
  ): Promise<SdpQueuePage> {
    const { filters, pageSize = SDP_PAGE_SIZE, sort } = view;
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    const newestField = since === undefined ? 'created_time' : 'last_updated_time';
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: pageSize,
          start_index: page * pageSize + 1,
          sort_field: sort ? QUEUE_SORT_FIELDS[sort.field] : newestField,
          sort_order: sort?.order ?? 'desc',
          get_total_count: false,
          search_criteria: {
            ...(queue === 'Unassigned'
              ? { field: 'group', condition: 'is' }
              : { field: 'group.name', condition: 'is', value: queue }),
            ...(filters || since !== undefined
              ? {
                  children: [
                    ...queueFilterCriteria(filters),
                    ...(since === undefined
                      ? []
                      : [
                          {
                            field: 'last_updated_time',
                            condition: 'greater or equal',
                            value: String(since),
                            logical_operator: 'AND',
                            children: [
                              {
                                field: 'created_time',
                                condition: 'greater or equal',
                                value: String(since),
                                logical_operator: 'OR',
                              },
                            ],
                          },
                        ]),
                  ],
                }
              : {}),
          },
          fields_required: QUEUE_FIELDS,
        },
      }),
    );
    const result = projectQueue(
      // The response bound scales with the page, so 100 rows allow what 50 rows always have.
      await this.json(
        url.toString(),
        signal,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            Accept: 'application/vnd.manageengine.sdp.v3+json',
          },
        },
        262144 * Math.max(1, pageSize / SDP_PAGE_SIZE),
      ),
      queue,
      page,
      pageSize,
    );
    return { ...result, ...(filters ? { filters } : {}), ...(sort ? { sort } : {}) };
  }
  /**
   * One read across every monitored queue, 100 tickets per page. A full read (no `since`) lists
   * unresolved tickets newest first. A change read lists every ticket changed since then, resolved
   * ones included, so a resolution still reaches alerts before the next full read drops it;
   * `done` lists the rows whose status ended the ticket's work.
   */
  async monitorQueues(
    token: string,
    signal: AbortSignal,
    queues: readonly SdpQueue[],
    page: number,
    since?: number,
  ): Promise<{ tickets: SdpQueueTicket[]; hasMore: boolean; done: string[] }> {
    const named = queues.filter((queue) => queue !== 'Unassigned');
    const unassigned = { field: 'group', condition: 'is' };
    let groups: Record<string, unknown> = unassigned;
    if (named.length)
      groups = {
        field: 'group.name',
        condition: 'is',
        values: named,
        ...(queues.includes('Unassigned')
          ? { children: [{ ...unassigned, logical_operator: 'OR' }] }
          : {}),
      };
    const scope =
      since === undefined
        ? { field: 'status.in_progress', condition: 'is', value: true, logical_operator: 'AND' }
        : {
            field: 'last_updated_time',
            condition: 'greater or equal',
            value: String(since),
            logical_operator: 'AND',
            children: [
              {
                field: 'created_time',
                condition: 'greater or equal',
                value: String(since),
                logical_operator: 'OR',
              },
            ],
          };
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: MONITOR_PAGE_SIZE,
          start_index: page * MONITOR_PAGE_SIZE + 1,
          sort_field: since === undefined ? 'created_time' : 'last_updated_time',
          sort_order: 'desc',
          get_total_count: false,
          search_criteria: [groups, scope],
          fields_required: QUEUE_FIELDS,
        },
      }),
    );
    const value = await this.json(
      url.toString(),
      signal,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      },
      262144 * (MONITOR_PAGE_SIZE / SDP_PAGE_SIZE),
    );
    // Each row takes the monitored queue's own spelling, since SDP compares group names without
    // case; a row outside every monitored queue is left out.
    const done: string[] = [];
    const tickets = SdpQueuePageSchema.shape.tickets.safeParse(
      queueRows(value, MONITOR_PAGE_SIZE).flatMap((row) => {
        const group = searchGroup(row.group).toUpperCase();
        const queue = queues.find((name) => name.toUpperCase() === group);
        if (!queue) return [];
        const ticket = queueTicket(row, queue);
        // SDP marks each status as in progress or not; its name is the fallback.
        const inProgress = isObject(row.status) ? row.status.in_progress : undefined;
        if (typeof inProgress === 'boolean' ? !inProgress : sdpTicketDone(ticket.status))
          done.push(ticket.id);
        return [ticket];
      }),
    );
    if (!tickets.success) throw new SdpProviderError('invalid', 0, 'queue-values');
    return {
      tickets: tickets.data,
      hasMore: (value as { list_info: { has_more_rows: boolean } }).list_info.has_more_rows,
      done,
    };
  }
  /**
   * Every request the person can see in SDP whose subject, requester or technician contains the
   * text, or whose number matches it, newest first, as SDP's own search finds them.
   */
  async searchTickets(
    token: string,
    signal: AbortSignal,
    query: string,
    page: number,
  ): Promise<SdpTicketSearch> {
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    const or = (field: string, condition = 'contains') => ({
      field,
      condition,
      value: query,
      logical_operator: 'OR',
    });
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: SDP_PAGE_SIZE,
          start_index: page * SDP_PAGE_SIZE + 1,
          sort_field: 'created_time',
          sort_order: 'desc',
          get_total_count: false,
          search_criteria: {
            field: 'subject',
            condition: 'contains',
            value: query,
            children: [
              or('requester.name'),
              or('technician.name'),
              ...(/^\d{1,30}$/.test(query) ? [or('display_id', 'is')] : []),
            ],
          },
          fields_required: QUEUE_FIELDS,
        },
      }),
    );
    const value = await this.json(url.toString(), signal, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: 'application/vnd.manageengine.sdp.v3+json',
      },
    });
    const rows = queueRows(value, SDP_PAGE_SIZE);
    const result = SdpTicketSearchSchema.safeParse({
      query,
      page,
      hasMore: (value as { list_info: { has_more_rows: boolean } }).list_info.has_more_rows,
      tickets: rows.map((row) => queueTicket(row, searchGroup(row.group))),
    });
    if (!result.success) throw new SdpProviderError('invalid', 0, 'queue-values');
    return result.data;
  }
  /** Which of these tickets have notes, in one list read of the documented `has_notes` field. */
  async queueNotes(
    token: string,
    signal: AbortSignal,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: ids.length,
          start_index: 1,
          get_total_count: false,
          search_criteria: { field: 'id', condition: 'is', values: ids },
          fields_required: ['id', 'has_notes'],
        },
      }),
    );
    const value = await this.json(url.toString(), signal, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: 'application/vnd.manageengine.sdp.v3+json',
      },
    });
    if (!isObject(value) || !Array.isArray(value.requests) || value.requests.length > ids.length)
      throw new SdpProviderError('invalid', 0, 'queue-shape');
    const notes = new Set<string>();
    for (const row of value.requests) {
      if (!isObject(row) || !ids.includes(String(row.id)) || typeof row.has_notes !== 'boolean')
        throw new SdpProviderError('invalid', 0, 'queue-fields');
      if (row.has_notes) notes.add(String(row.id));
    }
    return notes;
  }
  async detail(
    token: string,
    signal: AbortSignal,
    id: string,
    page: number,
    includeAutoNotifications = false,
    known: ReadonlyMap<string, SdpConversation> = new Map(),
  ): Promise<SdpDetail> {
    const base = `https://support.campingworld.com/app/itdesk/api/v3/requests/${id}`;
    const headers = {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.manageengine.sdp.v3+json',
    };
    const value = await this.json(base, signal, { headers });
    if (!isObject(value) || !isObject(value.request) || String(value.request.id) !== id)
      throw new SdpProviderError('invalid');
    const description = value.request.description ?? '';
    // Custom field names, notes and messages are independent reads; fetch them together.
    const [customFields, notes, history] = await Promise.all([
      this.fieldDefinitions(token, signal, id, value.request),
      this.notes(base, headers, signal, page),
      this.conversations(base, headers, signal, page, includeAutoNotifications, known),
    ]);
    const properties = projectProperties(value.request, customFields);
    const attachments = projectAttachments(value.request);
    const resolution = resolutionContent(value.request.resolution);
    const result = SdpDetailSchema.safeParse({
      id,
      description,
      includeAutoNotifications,
      properties,
      attachments,
      resolution,
      page,
      ...notes,
      ...history,
    });
    if (!result.success) throw new SdpProviderError('invalid');
    return result.data;
  }
  private async fieldDefinitions(
    token: string,
    signal: AbortSignal,
    id: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (
      !isObject(request.udf_fields) ||
      !Object.values(request.udf_fields).some((v) => v !== null && v !== '')
    )
      return {};
    try {
      return await readCustomFieldCatalog(this, token, signal);
    } catch (error) {
      if (
        !(error instanceof SdpProviderError) ||
        error.kind !== 'denied' ||
        ![401, 403, 404].includes(error.httpStatus ?? 0)
      )
        throw error;
      const parent = await this.json(
        `https://support.campingworld.com/app/itdesk/api/v3/requests/${id}`,
        signal,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            Accept: 'application/vnd.manageengine.sdp.v3+json',
          },
        },
      );
      if (!isObject(parent) || !isObject(parent.request) || String(parent.request.id) !== id)
        throw new SdpProviderError('invalid');
      return {};
    }
  }
  private async conversations(
    base: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    page: number,
    includeAutoNotifications: boolean,
    known: ReadonlyMap<string, SdpConversation>,
  ): Promise<Pick<SdpDetail, 'conversations' | 'hasMore' | 'conversationError'>> {
    const url = new URL(`${base}/conversations`);
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: 10,
          start_index: page * 10 + 1,
          sort_field: 'created_time',
          search_criteria: emailConversationCriteria(includeAutoNotifications),
          sort_order: 'desc',
        },
      }),
    );
    try {
      const notifications = await this.json(url.toString(), signal, { headers });
      if (
        !isObject(notifications) ||
        !Array.isArray(notifications.conversations) ||
        notifications.conversations.length > 10 ||
        !isObject(notifications.list_info) ||
        typeof notifications.list_info.has_more_rows !== 'boolean'
      )
        throw new SdpProviderError('invalid');
      const ids = notifications.conversations.map((item) => {
        if (!isObject(item) || !/^\d{1,30}$/.test(String(item.id)))
          throw new SdpProviderError('invalid');
        return String(item.id);
      });
      // A sent message never changes, so one already read for this ticket is not read again.
      const conversations = await mapBounded(ids, async (itemId) => {
        const seen = known.get(itemId);
        if (seen) return seen;
        const full = await this.json(`${base}/notifications/${itemId}`, signal, { headers });
        if (
          !isObject(full) ||
          !isObject(full.notification) ||
          String(full.notification.id) !== itemId
        )
          throw new SdpProviderError('invalid');
        const row = full.notification;
        return {
          id: String(row.id),
          subject: typeof row.subject === 'string' ? row.subject : '',
          body: typeof row.description === 'string' ? row.description : '',
          author: queueLabel(row.sender ?? row.sent_by, 'SDP'),
          createdAt: queueTime(row.time ?? row.sent_time),
        };
      });
      return { conversations, hasMore: notifications.list_info.has_more_rows };
    } catch (error) {
      if (signal.aborted) throw error;
      // History endpoints may be unavailable independently of an authorized request read.
      return {
        conversations: [],
        hasMore: false,
        conversationError:
          'Conversation history could not be loaded from SDP. Refresh the ticket to retry.',
      };
    }
  }
  private async notes(
    base: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    page: number,
  ): Promise<Pick<SdpDetail, 'notes' | 'notesHasMore' | 'notesError'>> {
    try {
      const url = new URL(`${base}/notes`);
      url.searchParams.set(
        'input_data',
        JSON.stringify({
          list_info: {
            row_count: 10,
            start_index: page * 10 + 1,
            sort_field: 'created_time',
            sort_order: 'desc',
          },
        }),
      );
      const value = await this.json(url.toString(), signal, { headers });
      if (
        !isObject(value) ||
        !Array.isArray(value.notes) ||
        value.notes.length > 10 ||
        !isObject(value.list_info) ||
        typeof value.list_info.has_more_rows !== 'boolean'
      )
        throw new SdpProviderError('invalid');
      const items = value.notes.map((item) => {
        if (!isObject(item) || !/^\d{1,30}$/.test(String(item.id)))
          throw new SdpProviderError('invalid');
        return item;
      });
      const notes = await mapBounded(items, async (item) => {
        let row = item;
        if (typeof row.description !== 'string') {
          const full = await this.json(`${base}/notes/${item.id}`, signal, { headers });
          if (!isObject(full) || !isObject(full.note) || String(full.note.id) !== String(item.id))
            throw new SdpProviderError('invalid');
          row = full.note;
        }
        if (typeof row.description !== 'string') throw new SdpProviderError('invalid');
        return {
          id: String(row.id),
          body: row.description,
          author: queueLabel(row.created_by ?? row.added_by, 'SDP'),
          createdAt: queueTime(row.added_time ?? row.created_time),
        };
      });
      return { notes, notesHasMore: value.list_info.has_more_rows };
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        notes: [],
        notesHasMore: false,
        notesError: 'SDP notes could not be loaded. Refresh the ticket to retry.',
      };
    }
  }
  async ticket(token: string, signal: AbortSignal): Promise<SdpTestTicket> {
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: 1,
          start_index: 1,
          get_total_count: false,
          search_criteria: { field: 'display_id', condition: 'is', value: SDP_TEST_TICKET },
          fields_required: FIELDS,
        },
      }),
    );
    return projectTestTicket(
      await this.json(url.toString(), signal, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      }),
    );
  }
}

/**
 * The SDP list field behind each sortable queue column. SDP sorts lookups by name, so priority
 * uses its id (SDP's own Low to High order) and the ticket number uses display_id.
 */
const QUEUE_SORT_FIELDS: Record<SdpQueueSortField, string> = {
  number: 'display_id',
  priority: 'priority.id',
  status: 'status.name',
  technician: 'technician.name',
  created: 'created_time',
};
const QUEUE_FIELDS = [
  'request_type',
  'category',
  'template',
  'id',
  'display_id',
  'subject',
  'status',
  'priority',
  'group',
  'technician',
  'created_time',
  'last_updated_time',
  'due_by_time',
  'notification_status',
  'unreplied_count',
  'is_read',
  // Only the requester's display name and VIP flag are kept; the rest of the profile is discarded.
  'requester',
];
const queueLabel = (value: unknown, fallback: string): string => {
  if (value == null) return fallback;
  if (!isObject(value) || typeof value.name !== 'string' || value.name.length > 200)
    throw new SdpProviderError('invalid', 0, 'label-value');
  return value.name;
};
const queueTime = (value: unknown): number | null => {
  if (value == null) return null;
  if (!isObject(value) || !/^\d{1,16}$/.test(String(value.value)))
    throw new SdpProviderError('invalid', 0, 'time-value');
  const time = Number(value.value);
  if (!Number.isSafeInteger(time) || time > 8640000000000000)
    throw new SdpProviderError('invalid', 0, 'time-value');
  return time;
};
function queueRows(value: unknown, pageSize: number): Record<string, unknown>[] {
  if (
    !isObject(value) ||
    !Array.isArray(value.requests) ||
    value.requests.length > pageSize ||
    !isObject(value.list_info) ||
    typeof value.list_info.has_more_rows !== 'boolean'
  )
    throw new SdpProviderError('invalid', 0, 'queue-shape');
  const rows = value.requests.map((row: unknown) => {
    if (!isObject(row) || Object.keys(row).some((key) => !QUEUE_FIELDS.includes(key)))
      throw new SdpProviderError('invalid', 0, 'queue-fields');
    return row;
  });
  if (new Set(rows.map((row) => String(row.id))).size !== rows.length)
    throw new SdpProviderError('invalid', 0, 'queue-values');
  return rows;
}
/** A search row's support group as a queue name: Unassigned when it has none. */
function searchGroup(value: unknown): string {
  const name = queueLabel(value, 'Unassigned')
    .replaceAll(/\p{Cc}/gu, ' ')
    .trim();
  return !name || name.toLowerCase() === 'unassigned' ? 'Unassigned' : name;
}
/** The requester's display name, bounded and without control characters, when SDP gives one. */
function requesterName(value: unknown): string | undefined {
  if (!isObject(value) || typeof value.name !== 'string') return undefined;
  const name = value.name
    .replaceAll(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, 200);
  return name || undefined;
}
function queueTicket(row: Record<string, unknown>, group: string) {
  const requester = requesterName(row.requester);
  return {
    id: String(row.id),
    number: String(row.display_id),
    subject: row.subject ?? '',
    status: queueLabel(row.status, 'Unknown'),
    priority: queueLabel(row.priority, 'Unspecified'),
    group,
    technician: queueLabel(row.technician, 'No technician'),
    ...(row.request_type !== undefined ? { requestType: queueLabel(row.request_type, '') } : {}),
    ...(row.category !== undefined ? { category: queueLabel(row.category, '') } : {}),
    ...(row.template !== undefined ? { template: queueLabel(row.template, '') } : {}),
    createdAt: queueTime(row.created_time),
    ...(row.last_updated_time !== undefined
      ? { updatedAt: queueTime(row.last_updated_time === 'null' ? null : row.last_updated_time) }
      : {}),
    dueAt: queueTime(row.due_by_time),
    ...(row.notification_status !== undefined
      ? { notificationStatus: row.notification_status }
      : {}),
    ...(row.unreplied_count !== undefined
      ? { unrepliedCount: row.unreplied_count === null ? 0 : Number(row.unreplied_count) }
      : {}),
    ...(typeof row.is_read === 'boolean' ? { providerUnread: !row.is_read } : {}),
    ...(isObject(row.requester) && row.requester.is_vip_user === true
      ? { vip: true as const }
      : {}),
    ...(requester ? { requesterName: requester } : {}),
  };
}
export function projectQueue(
  value: unknown,
  queue: SdpQueue,
  page: number,
  pageSize = SDP_PAGE_SIZE,
): SdpQueuePage {
  const tickets = queueRows(value, pageSize).map((row) => {
    const group = queueLabel(row.group, 'Unassigned');
    if (
      group.toUpperCase() !== queue.toUpperCase() ||
      (queue === 'Unassigned' && row.group != null)
    )
      throw new SdpProviderError('invalid', 0, 'queue-group');
    return queueTicket(row, queue);
  });
  const result = SdpQueuePageSchema.safeParse({
    queue,
    page,
    ...(pageSize === SDP_PAGE_SIZE ? {} : { pageSize }),
    hasMore: (value as { list_info: { has_more_rows: boolean } }).list_info.has_more_rows,
    tickets,
  });
  if (!result.success) {
    loggers.main.warn('SDP queue validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
    throw new SdpProviderError('invalid', 0, 'queue-values');
  }
  return result.data;
}

/** The person's display name and sign-in email; other profile fields are discarded. */
function accountProfile(value: Record<string, unknown>): SdpAccountProfile | undefined {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const email = text(value.Email, 254);
  const validEmail = /^[^\s@]+@[^\s@]+$/.test(email) ? email : '';
  const name =
    text(value.Display_Name, 200) ||
    `${text(value.First_Name, 99)} ${text(value.Last_Name, 100)}`.trim() ||
    validEmail;
  const parsed = SdpAccountProfileSchema.safeParse({
    name,
    ...(validEmail ? { email: validEmail } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}
/** Retain ticket properties, not whole provider user profiles or unbounded raw JSON. */
export function projectProperties(
  row: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): NonNullable<SdpDetail['properties']> {
  const fields: [string, string][] = [
    ['request_type', 'Request type'],
    ['requester', 'Requester'],
    ['on_behalf_of', 'On behalf of'],
    ['submitted_by', 'Submitted by'],
    ['created_by', 'Created by'],
    ['status', 'Status'],
    ['group', 'Support group'],
    ['technician', 'Technician'],
    ['impact', 'Impact'],
    ['urgency', 'Urgency'],
    ['priority', 'Priority'],
    ['category', 'Category'],
    ['subcategory', 'Subcategory'],
    ['item', 'Item'],
    ['site', 'Site'],
    ['department', 'Department'],
    ['mode', 'Mode'],
    ['level', 'Level'],
    ['template', 'Template'],
    ['sla', 'SLA'],
    ['service_category', 'Service category'],
    ['lifecycle', 'Workflow'],
    ['approval_status', 'Approval status'],
    ['created_time', 'Created'],
    ['last_updated_time', 'Updated'],
    ['assigned_time', 'Assigned'],
    ['due_by_time', 'Due'],
    ['first_response_due_by_time', 'Response due'],
    ['responded_time', 'Responded'],
    ['resolved_time', 'Resolved'],
    ['completed_time', 'Completed'],
    ['scheduled_start_time', 'Scheduled start'],
    ['scheduled_end_time', 'Scheduled end'],
    ['is_overdue', 'Overdue'],
    ['is_first_response_overdue', 'Response overdue'],
    ['is_escalated', 'Escalated'],
    ['is_service_request', 'Service request'],
    ['assets', 'Assets'],
    ['configuration_items', 'Configuration items'],
    ['attachments', 'Attachments'],
    ['has_attachments', 'Has attachments'],
    ['has_notes', 'Has notes'],
    ['has_linked_requests', 'Has linked requests'],
    ['has_problem', 'Has associated problem'],
    ['has_project', 'Has project'],
    ['service_cost', 'Service cost'],
    ['total_cost', 'Total cost'],
  ];
  const display = (value: unknown): string => {
    if (value == null) return 'Not set';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(display).join(', ') || 'None';
    if (isObject(value))
      return display(
        value.name ??
          value.display_value ??
          value.filename ??
          value.file_name ??
          value.value ??
          value.id,
      );
    return 'Not set';
  };
  const result = fields
    .filter(([key]) => key in row)
    .map(([key, label]) => ({ label, value: display(row[key]) }));
  // Preserve populated request-specific form answers. Keys remain visible when SDP supplies no label.
  const addFields = (value: unknown, path: string, depth = 0): void => {
    if (value == null || value === '') return;
    if (depth > 6 || result.length >= 250) throw new SdpProviderError('invalid');
    if (
      isObject(value) &&
      !('name' in value) &&
      !('display_value' in value) &&
      !('value' in value)
    ) {
      for (const [key, entry] of Object.entries(value)) {
        const definition =
          path === 'Additional fields' && isObject(customFields[key]) ? customFields[key] : {};
        const name =
          typeof definition.display_name === 'string'
            ? definition.display_name.slice(0, 200)
            : customFieldLabel(key);
        addFields(entry, `${path} / ${name}`, depth + 1);
      }
    } else result.push({ label: path.slice(0, 200), value: display(value) });
  };
  addFields(row.udf_fields, 'Additional fields');
  addFields(row.resources, 'Form answers');
  return result;
}

const resolutionContent = (value: unknown): unknown =>
  isObject(value) ? (value.content ?? '') : '';
