import {
  SDP_RESOURCE_FIELDS,
  SdpResourcePageSchema,
  type SdpResourceCommand,
  type SdpResourceMutation,
  type SdpResourceName,
  type SdpResourcePage,
} from '@shared/sdpResources';
import { SdpProvider, SdpProviderError, isObject } from './SdpProvider';
const BASE = 'https://support.campingworld.com/app/itdesk/api/v3/requests';
export const resourceHeaders = (token: string) => ({
  Authorization: `Zoho-oauthtoken ${token}`,
  Accept: 'application/vnd.manageengine.sdp.v3+json',
});
export function resourcePath(value: {
  id: string;
  resource: SdpResourceName;
  levelId?: string;
  recordId?: string;
}): string {
  const nested =
    value.resource === 'approvals' ? `approval_levels/${value.levelId}/approvals` : value.resource;
  const suffix = value.recordId ? '/' + value.recordId : '';
  return `${BASE}/${value.id}/${nested}${suffix}`;
}
const wrappers: Record<SdpResourceName, string> = {
  tasks: 'task',
  worklogs: 'worklog',
  approval_levels: 'approval_level',
  approvals: 'approval',
};
type Codec =
  'name' | 'date' | 'email' | 'id' | 'scalar' | 'html' | 'boolean' | 'value' | 'hours' | 'minutes';
const fieldMap: Record<string, [string, Codec]> = {
  title: ['title', 'scalar'],
  description: ['description', 'html'],
  comments: ['comments', 'scalar'],
  status: ['status', 'name'],
  priority: ['priority', 'name'],
  taskType: ['task_type', 'name'],
  scheduledStart: ['scheduled_start_time', 'date'],
  scheduledEnd: ['scheduled_end_time', 'date'],
  actualStart: ['actual_start_time', 'date'],
  actualEnd: ['actual_end_time', 'date'],
  startTime: ['start_time', 'date'],
  endTime: ['end_time', 'date'],
  completion: ['percentage_completion', 'scalar'],
  effortDays: ['estimated_effort_days', 'scalar'],
  effortHours: ['estimated_effort_hours', 'scalar'],
  effortMinutes: ['estimated_effort_minutes', 'scalar'],
  additionalCost: ['additional_cost', 'scalar'],
  exchangeRate: ['exchange_rate', 'scalar'],
  level: ['level', 'scalar'],
  ownerEmail: ['owner', 'email'],
  approverEmail: ['approver', 'email'],
  templateId: ['template', 'id'],
  currencyId: ['currency', 'id'],
  includeNonoperational: ['include_nonoperational_hours', 'boolean'],
  techCharge: ['tech_charge', 'value'],
  otherCharge: ['other_charge', 'value'],
  hours: ['time_spent', 'hours'],
  minutes: ['time_spent', 'minutes'],
};
const html = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
function encode(value: string, codec: Codec): unknown {
  switch (codec) {
    case 'name':
      return { name: value };
    case 'email':
      return { email_id: value };
    case 'id':
      return { id: value };
    case 'date':
      return { value: String(Date.parse(value)) };
    case 'value':
      return { value };
    case 'html':
      return html(value);
    case 'boolean':
      return value === 'true';
    default:
      return value;
  }
}
export function resourceInput(value: SdpResourceMutation): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value.fields)) {
    if (key === 'hours' || key === 'minutes') continue;
    const [target, codec] = fieldMap[key]!;
    result[target] = encode(field, codec);
  }
  if (value.resource === 'worklogs') {
    result.mark_first_response = false;
    if (value.fields.hours !== undefined || value.fields.minutes !== undefined)
      result.time_spent = {
        hours: value.fields.hours ?? '0',
        minutes: value.fields.minutes ?? '0',
      };
  }
  return { [wrappers[value.resource]]: result };
}
function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value).slice(0, 12000);
  return '';
}
function nested(value: unknown, key: string): string {
  return isObject(value) ? scalar(value[key]) : '';
}
function decode(value: unknown, codec: Codec): string {
  switch (codec) {
    case 'name':
      return nested(value, 'name');
    case 'email':
      return nested(value, 'email_id');
    case 'id':
      return nested(value, 'id');
    case 'value':
      return nested(value, 'value');
    case 'hours':
      return nested(value, 'hours');
    case 'minutes':
      return nested(value, 'minutes');
    case 'date': {
      const stamp = nested(value, 'value');
      if (!stamp) return '';
      const date = new Date(Number(stamp));
      return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }
    default:
      return scalar(value);
  }
}
function projectFields(
  row: Record<string, unknown>,
  resource: SdpResourceName,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(SDP_RESOURCE_FIELDS[resource])) {
    const [source, codec] = fieldMap[key]!;
    const value = decode(row[source], codec);
    if (value) fields[key] = value;
  }
  return fields;
}
export async function readResources(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: SdpResourceCommand,
): Promise<SdpResourcePage> {
  const url = new URL(resourcePath(command));
  url.searchParams.set(
    'input_data',
    JSON.stringify({ list_info: { start_index: command.page * 50 + 1, row_count: 50 } }),
  );
  const value = await provider.json(url.toString(), signal, { headers: resourceHeaders(token) });
  if (!isObject(value) || !Array.isArray(value[command.resource]))
    throw new SdpProviderError('invalid');
  const rows = (value[command.resource] as unknown[]).map((row) => {
    if (!isObject(row)) throw new SdpProviderError('invalid');
    const fields = projectFields(row, command.resource);
    return {
      id: scalar(row.id),
      title: scalar(
        row.title ||
          row.name ||
          fields.approverEmail ||
          fields.description ||
          fields.level ||
          row.id,
      ).slice(0, 500),
      status: nested(row.status, 'name') || nested(row.approval_status, 'name'),
      fields,
    };
  });
  return SdpResourcePageSchema.parse({
    id: command.id,
    resource: command.resource,
    levelId: command.levelId,
    page: command.page,
    rows,
    hasMore: isObject(value.list_info) && value.list_info.has_more_rows === true,
  });
}
export async function resourceBaseline(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpResourceMutation,
): Promise<unknown> {
  if (!mutation.recordId) return null;
  const value = await provider.json(resourcePath(mutation), signal, {
    headers: resourceHeaders(token),
  });
  const record = isObject(value) ? value[wrappers[mutation.resource]] : undefined;
  if (!isObject(record) || String(record.id) !== mutation.recordId)
    throw new SdpProviderError('invalid');
  return record;
}
