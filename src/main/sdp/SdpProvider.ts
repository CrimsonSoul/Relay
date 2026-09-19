import { emailConversationCriteria } from './SdpConversationQuery';
import { queueFilterCriteria, type SdpQueueFilters } from '@shared/sdpQueueFilters';
import {
  SDP_PAGE_SIZE,
  SdpDetailSchema,
  type SdpDetail,
  SdpQueuePageSchema,
  SDP_TEST_TICKET,
  type SdpQueue,
  type SdpQueuePage,
  type SdpTestTicket,
} from '@shared/sdpAccount';
import { projectAttachments } from './SdpAttachments';
import { SDP_ATTACHMENT_MAX_BYTES } from '@shared/sdpAttachments';
import { loggers } from '../logger';
import { readCustomFieldCatalog } from './SdpFieldCatalog';
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
      | 'time-value',
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
function throttled(retry: string | null): SdpProviderError {
  const value = retry ?? '';
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return new SdpProviderError(
    'throttled',
    Number.isFinite(delay) ? Math.max(0, Math.min(delay, 3600000)) : 60000,
  );
}
function responseError(response: Response): SdpProviderError {
  if (response.status === 429) return throttled(response.headers.get('Retry-After'));
  if ([500, 502, 503, 504].includes(response.status)) return new SdpProviderError('outage');
  if ([401, 403, 404].includes(response.status))
    return new SdpProviderError('denied', 0, 'http', response.status);
  return new SdpProviderError('invalid', 0, 'http', response.status);
}
export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
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
export class SdpProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async json(
    url: string,
    signal: AbortSignal,
    init: NonNullable<Parameters<typeof fetch>[1]> = {},
    maxBytes = 262144,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
    } catch (error) {
      if (signal.aborted) throw new SdpProviderError('invalid');
      const code = isObject(error) && isObject(error.cause) ? String(error.cause.code ?? '') : '';
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
      if (response.status === 400 && ['POST', 'PUT', 'DELETE'].includes(init.method ?? '')) {
        const raw = await this.readJson(response, maxBytes);
        throw new SdpValidationError(validationFields(raw));
      }
      await response.body?.cancel();
      throw responseError(response);
    }
    return this.readJson(response, maxBytes);
  }
  private async readJson(response: Response, maxBytes: number): Promise<unknown> {
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
  ): Promise<Buffer> {
    let response: Response;
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
      if ([401, 403, 404].includes(response.status)) throw new SdpProviderError('denied');
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
        if (size > SDP_ATTACHMENT_MAX_BYTES) throw new SdpProviderError('invalid');
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
  async identity(token: string, signal: AbortSignal): Promise<string> {
    const value = await this.json(`${SDP_ACCOUNTS}/oauth/user/info`, signal, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    // The provider's verified immutable ID is the only retained profile field.
    const id = isObject(value) ? value.ZUID : undefined;
    if (
      !(typeof id === 'string' && /^\d{1,30}$/.test(id)) &&
      !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    )
      throw new SdpProviderError('invalid');
    return String(id);
  }
  async queue(
    token: string,
    signal: AbortSignal,
    queue: SdpQueue,
    page: number,
    since?: number,
    filters?: SdpQueueFilters,
  ): Promise<SdpQueuePage> {
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/requests');
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          row_count: SDP_PAGE_SIZE,
          start_index: page * SDP_PAGE_SIZE + 1,
          sort_field: since === undefined ? 'created_time' : 'last_updated_time',
          sort_order: 'desc',
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
      await this.json(url.toString(), signal, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      }),
      queue,
      page,
    );
    return filters ? { ...result, filters } : result;
  }
  async detail(
    token: string,
    signal: AbortSignal,
    id: string,
    page: number,
    includeAutoNotifications = false,
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
    const customFields = await this.fieldDefinitions(token, signal, id, value.request);
    const properties = projectProperties(value.request, customFields);
    const attachments = projectAttachments(value.request);
    const resolution = resolutionContent(value.request.resolution);
    const notes = await this.notes(base, headers, signal, page);
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
    let history: {
      conversations: SdpDetail['conversations'];
      hasMore: boolean;
      conversationError?: string;
    };
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
      const conversations: SdpDetail['conversations'] = [];
      for (const item of notifications.conversations) {
        if (!isObject(item) || !/^\d{1,30}$/.test(String(item.id)))
          throw new SdpProviderError('invalid');
        const full = await this.json(`${base}/notifications/${item.id}`, signal, { headers });
        if (
          !isObject(full) ||
          !isObject(full.notification) ||
          String(full.notification.id) !== String(item.id)
        )
          throw new SdpProviderError('invalid');
        const row = full.notification;
        conversations.push({
          id: String(row.id),
          subject: typeof row.subject === 'string' ? row.subject : '',
          body: typeof row.description === 'string' ? row.description : '',
          author: queueLabel(row.sender ?? row.sent_by, 'SDP'),
          createdAt: queueTime(row.time ?? row.sent_time),
        });
      }
      history = { conversations, hasMore: notifications.list_info.has_more_rows };
    } catch (error) {
      if (signal.aborted) throw error;
      // History endpoints may be unavailable independently of an authorized request read.
      history = {
        conversations: [],
        hasMore: false,
        conversationError:
          'Conversation history could not be loaded from SDP. Refresh the ticket to retry.',
      };
    }
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
      const notes: NonNullable<SdpDetail['notes']> = [];
      for (const item of value.notes) {
        if (!isObject(item) || !/^\d{1,30}$/.test(String(item.id)))
          throw new SdpProviderError('invalid');
        let row = item;
        if (typeof row.description !== 'string') {
          const full = await this.json(`${base}/notes/${item.id}`, signal, { headers });
          if (!isObject(full) || !isObject(full.note) || String(full.note.id) !== String(item.id))
            throw new SdpProviderError('invalid');
          row = full.note;
        }
        if (typeof row.description !== 'string') throw new SdpProviderError('invalid');
        notes.push({
          id: String(row.id),
          body: row.description,
          author: queueLabel(row.added_by, 'SDP'),
          createdAt: queueTime(row.added_time ?? row.created_time),
        });
      }
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
export function projectQueue(value: unknown, queue: SdpQueue, page: number): SdpQueuePage {
  if (
    !isObject(value) ||
    !Array.isArray(value.requests) ||
    value.requests.length > SDP_PAGE_SIZE ||
    !isObject(value.list_info) ||
    typeof value.list_info.has_more_rows !== 'boolean'
  )
    throw new SdpProviderError('invalid', 0, 'queue-shape');
  const tickets = value.requests.map((row: unknown) => {
    if (!isObject(row) || Object.keys(row).some((key) => !QUEUE_FIELDS.includes(key)))
      throw new SdpProviderError('invalid', 0, 'queue-fields');
    const group = queueLabel(row.group, 'Unassigned');
    if (
      group.toUpperCase() !== queue.toUpperCase() ||
      (queue === 'Unassigned' && row.group != null)
    )
      throw new SdpProviderError('invalid', 0, 'queue-group');
    return {
      id: String(row.id),
      number: String(row.display_id),
      subject: row.subject ?? '',
      status: queueLabel(row.status, 'Unknown'),
      priority: queueLabel(row.priority, 'Unspecified'),
      group: queue,
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
    };
  });
  const result = SdpQueuePageSchema.safeParse({
    queue,
    page,
    hasMore: value.list_info.has_more_rows,
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
  if (new Set(tickets.map((ticket) => ticket.id)).size !== tickets.length)
    throw new SdpProviderError('invalid', 0, 'queue-values');
  return result.data;
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
          typeof definition.display_name === 'string' ? definition.display_name.slice(0, 200) : key;
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
