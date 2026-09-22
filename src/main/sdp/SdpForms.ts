import { z } from 'zod';
import {
  SdpFormSchema,
  SdpOptionsSchema,
  SdpReplyContextSchema,
  type SdpStandardOptionsCommand,
  type SdpForm,
  type SdpFormField,
  type SdpFieldValue,
} from '@shared/sdpForm';
import type { SdpBrokerCommand } from '@shared/sdpAccount';
import type { SdpMutation } from '@shared/sdpMutation';
import { scalarText, SdpProvider, SdpProviderError, isObject } from './SdpProvider';
import { loggers } from '../logger';
import { publicFieldInfo, readCustomFieldCatalog } from './SdpFieldCatalog';
import { validateRelation } from './SdpTicketRelations';
const BASE = 'https://support.campingworld.com/app/itdesk/api/v3/requests';
const headers = (token: string) => ({
  Authorization: `Zoho-oauthtoken ${token}`,
  Accept: 'application/vnd.manageengine.sdp.v3+json',
});
export class SdpFormUnavailableError extends Error {
  constructor() {
    super(
      'SDP did not authorize this editor request. Your account is still connected. Cancel to return to the ticket.',
    );
  }
}
const object = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const label = (v: unknown, fallback = '') => (typeof v === 'string' ? v.slice(0, 250) : fallback);
const at = (v: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((value, part) => object(value)[part], v);
const writable = new Set([
  'subject',
  'description',
  'requester',
  'on_behalf_of',
  'status',
  'priority',
  'group',
  'technician',
  'request_type',
  'category',
  'subcategory',
  'item',
  'impact',
  'urgency',
  'site',
  'mode',
  'level',
  'assets',
  'configuration_items',
  'due_by_time',
  'first_response_due_by_time',
  'created_time',
  'resolution.content',
  'update_reason',
]);
// SDP values deliberately retain their schema-defined scalar, reference or list type.
// eslint-disable-next-line sonarjs/function-return-type
function value(v: unknown, type: string): SdpFieldValue {
  if (v == null) return null;
  if (Array.isArray(v))
    return v
      .slice(0, 200)
      .map((item) => value(item, type))
      .filter(
        (item): item is Exclude<SdpFieldValue, null | unknown[]> =>
          item !== null && !Array.isArray(item),
      );
  if (type === 'datestamp')
    return typeof object(v).value === 'string' ? String(object(v).value) : null;
  if (type === 'datetime') {
    const n = Number(object(v).value);
    return Number.isFinite(n) ? n : null;
  }
  if (isObject(v))
    return /^\d{1,30}$/.test(String(v.id)) ? { id: String(v.id), name: label(v.name) } : null;
  if (typeof v === 'string') return v.slice(0, 100000);
  return typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}
function choices(v: unknown) {
  return array(v)
    .filter((item) => object(item).deleted !== true)
    .flatMap<SdpFormField['choices'][number]>((item) => {
      const row = object(item);
      const id = scalarText(row.id);
      if (/^\d{1,30}$/.test(id) && typeof row.name === 'string')
        return [{ label: label(row.name), value: { id, name: label(row.name) } }];
      if (typeof row.value === 'string')
        return [{ label: label(row.display_value, row.value), value: row.value }];
      return [];
    });
}
async function get(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  path: string,
  input?: unknown,
  parentId?: string,
) {
  const url = new URL(`${BASE}/${path}`);
  if (input) url.searchParams.set('input_data', JSON.stringify(input));
  try {
    return object(await provider.json(url.href, signal, { headers: headers(token) }, 1048576));
  } catch (error) {
    loggers.main.warn('SDP form read failed', {
      resource: path.replace(/\d+/g, ':id'),
      kind: error instanceof SdpProviderError ? error.kind : 'unknown',
      status: error instanceof SdpProviderError ? error.httpStatus : undefined,
    });
    if (
      parentId &&
      error instanceof SdpProviderError &&
      error.kind === 'denied' &&
      [401, 403, 404].includes(error.httpStatus ?? 0)
    ) {
      // UI metadata can reject OAuth while the public ticket API still authorizes this user.
      // Revalidate live access; never infer it from a cached ticket or ignore a real denial.
      const parent = await get(provider, token, signal, parentId);
      if (String(object(parent.request).id) !== parentId) throw new SdpProviderError('invalid');
      throw new SdpFormUnavailableError();
    }
    throw error;
  }
}
function links(raw: Record<string, unknown>): Record<string, unknown>[] {
  return array(Array.isArray(raw._links) ? raw._links : object(raw._links).links).map(object);
}
function fieldInfo(metadata: Record<string, unknown>, key: string) {
  if (key.startsWith('udf_fields.'))
    return object(object(object(metadata.udf_fields).fields)[key.slice(11)]);
  return object(metadata[key === 'resolution.content' ? 'description' : key]);
}
function fieldKind(
  info: Record<string, unknown>,
  options: SdpFormField['choices'],
): SdpFormField['kind'] {
  if (info.type === 'lookup') return 'lookup';
  if (
    options.length ||
    /Pick List|Check Box|Radio Button|Multi Select/.test(String(info.display_type))
  )
    return 'choice';
  if (info.type === 'datetime' || info.type === 'datestamp') return 'date';
  if (info.type === 'boolean') return 'boolean';
  if (['long', 'double', 'integer', 'decimal'].includes(String(info.type))) return 'number';
  if (info.type === 'html' || info.display_type === 'Multi Line') return 'multiline';
  return 'text';
}
function projectField(
  field: Record<string, unknown>,
  section: Record<string, unknown>,
  metadata: Record<string, unknown>,
  allowed: Record<string, unknown>,
  request: Record<string, unknown>,
  defaults: Record<string, unknown>,
  permissions: { canEdit: boolean; blocked: unknown[] },
): SdpFormField[] {
  const key = label(field.name);
  if (!writable.has(key) && !/^udf_fields\.[a-z][a-z0-9_]*$/.test(key)) return [];
  const declared = fieldInfo(metadata, key);
  const info = Object.keys(declared).length
    ? declared
    : publicFieldInfo(key, at(request, key), at(defaults, key), at(allowed, key));
  if (!Object.keys(info).length) return [];
  const options = choices(at(allowed, key));
  const kind = fieldKind(info, options);
  const constraints = object(info.constraints);
  const fallbackLength = kind === 'multiline' ? 100000 : 250;
  return [
    {
      key,
      label: key === 'resolution.content' ? 'Resolution' : label(info.display_name, key),
      section: label(section.name, 'Details'),
      kind,
      required: field.mandatory === true,
      readOnly:
        !permissions.canEdit ||
        info.read_only === true ||
        info.editable === false ||
        permissions.blocked.includes(key),
      multiple: info.multiple === true,
      dateOnly: info.type === 'datestamp',
      integer: info.type === 'long',
      minLength: Math.max(0, Number(constraints.min_length) || 0),
      maxLength: Math.min(100000, Math.max(1, Number(constraints.max_length) || fallbackLength)),
      dependencies: array(info.depends_on).filter((v): v is string => typeof v === 'string'),
      choices: options,
      value: value(at(request, key), String(info.type)),
    },
  ];
}
export async function readForm(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  id: string,
): Promise<SdpForm> {
  const [parent, permissions] = await Promise.all([
    get(provider, token, signal, id),
    get(provider, token, signal, `${id}/_links`, undefined, id),
  ]);
  const request = object(parent.request);
  if (String(request.id) !== id) throw new SdpProviderError('invalid');
  let customFields: Record<string, unknown> | undefined;
  try {
    customFields = await readCustomFieldCatalog(provider, token, signal);
  } catch (error) {
    if (
      !(error instanceof SdpProviderError) ||
      error.kind !== 'denied' ||
      ![401, 403, 404].includes(error.httpStatus ?? 0)
    )
      throw error;
    // Old grants may lack setup.READ. A metadata denial is not a ticket/session denial.
    const authorized = await get(provider, token, signal, id);
    if (String(object(authorized.request).id) !== id) throw new SdpProviderError('invalid');
  }
  const template = object(request.template);
  const templateId = scalarText(template.id);
  if (!/^\d{1,30}$/.test(templateId)) throw new SdpProviderError('invalid');
  const [layoutRaw, allowedRaw] = await Promise.all([
    get(
      provider,
      token,
      signal,
      `${id}/template/${templateId}/_get_template_with_layout`,
      undefined,
      id,
    ),
    get(
      provider,
      token,
      signal,
      `${id}/_allowed_values_for_fields`,
      {
        list_info: { for: templateId },
      },
      id,
    ),
  ]);
  const metadata = { udf_fields: { fields: customFields ?? {} } };
  const allowed = object(allowedRaw.allowed_values);
  const layout = array(object(layoutRaw.request_template).layouts)
    .map(object)
    .find((l) => l.name === 'technician_layout');
  if (!layout) throw new SdpProviderError('invalid');
  const edit = links(permissions).find((l) => l.name === 'edit' && l.method === 'put');
  const blocked = array(edit?.non_editable_fields);
  const fields = array(layout.sections)
    .map(object)
    .flatMap((section) =>
      array(section.fields)
        .map(object)
        .flatMap((field) =>
          projectField(
            field,
            section,
            metadata,
            allowed,
            request,
            object(object(layoutRaw.request_template).request),
            { canEdit: !!edit, blocked },
          ),
        ),
    );
  return SdpFormSchema.parse({
    id,
    template: { id: templateId, name: label(template.name) },
    fields,
    canEdit: !!edit,
    metadataAvailable: customFields !== undefined,
    unavailableFields: array(layout.sections)
      .map(object)
      .flatMap((s) => array(s.fields).map(object))
      .map((f) => label(f.name))
      .filter(
        (key) => /^udf_fields\.[a-z][a-z0-9_]*$/.test(key) && !fields.some((f) => f.key === key),
      ),
  });
}
export async function readOptions(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: Extract<SdpBrokerCommand, { action: 'readOptions' }>,
  form: SdpForm,
) {
  const field = form.fields.find((f) => f.key === command.field);
  if (!field || !['lookup', 'choice'].includes(field.kind) || field.readOnly)
    throw new SdpProviderError('invalid');
  const criteria: unknown[] = [];
  for (const [key, v] of Object.entries(command.dependencies)) {
    if (!field.dependencies.includes(key)) throw new SdpProviderError('invalid');
    const lookupKey =
      field.key === 'technician'
        ? (({ site: 'associated_sites', group: 'groups' } as Record<string, string>)[key] ?? key)
        : key;
    if (v !== null)
      criteria.push({
        field: isObject(v) ? `${lookupKey}.id` : lookupKey,
        condition: 'is',
        value: isObject(v) ? v.id : v,
        logical_operator: 'and',
      });
  }
  criteria.push({
    field: 'name',
    condition: 'like',
    values: [command.search],
    logical_operator: 'and',
  });
  const data = await get(
    provider,
    token,
    signal,
    `${command.id}/${field.key.replaceAll('.', '/')}`,
    { list_info: { start_index: command.page * 50 + 1, row_count: 50, search_criteria: criteria } },
    command.id,
  );
  const rows = Object.entries(data).find(
    ([key, v]) => key !== 'response_status' && Array.isArray(v),
  )?.[1];
  if (!rows) throw new SdpProviderError('invalid');
  return SdpOptionsSchema.parse({
    field: field.key,
    choices: choices(rows),
    hasMore: object(data.list_info).has_more_rows === true,
  });
}
/** Request-scoped Cloud lookup catalogs, also available before a ticket is created. */
export async function readStandardOptions(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  command: SdpStandardOptionsCommand,
) {
  const criteria: unknown[] = [{ field: 'name', condition: 'like', values: [command.search] }];
  if (command.groupId)
    criteria.push({
      field: 'groups.id',
      condition: 'is',
      value: command.groupId,
      logical_operator: 'and',
    });
  const data = await get(provider, token, signal, command.field, {
    list_info: { start_index: command.page * 50 + 1, row_count: 50, search_criteria: criteria },
  });
  const rows = data[command.field];
  if (!Array.isArray(rows)) throw new SdpProviderError('invalid');
  return SdpOptionsSchema.parse({
    field: command.field,
    choices: choices(rows),
    hasMore: object(data.list_info).has_more_rows === true,
  });
}
export async function readReplyContext(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  id: string,
  forward = false,
  sourceId?: string,
) {
  const [raw, permissions] = await Promise.all([
    get(provider, token, signal, id),
    get(
      provider,
      token,
      signal,
      `${id}/notifications/_links`,
      { operations_required: ['add'] },
      id,
    ),
  ]);
  const request = object(raw.request);
  if (String(request.id) !== id) throw new SdpProviderError('invalid');
  const source =
    forward && sourceId
      ? object(
          (await get(provider, token, signal, `${id}/notifications/${sourceId}`, undefined, id))
            .notification,
        )
      : request;
  if (forward && sourceId && String(source.id) !== sourceId) throw new SdpProviderError('invalid');
  const email = label(object(request.requester).email_id);
  const emails = (v: unknown) =>
    array(v).filter((v): v is string => z.email().safeParse(v).success);
  return SdpReplyContextSchema.parse({
    id,
    subject:
      `${forward ? 'Fwd' : 'Re'}: [Request ID :##${label(object(request.display_key).display_value, scalarText(request.display_id, id))}##] : ${label(source.subject)}`.slice(
        0,
        250,
      ),
    to: forward ? [] : emails([email]),
    cc: forward ? [] : emails(request.email_cc),
    ...(forward
      ? { body: typeof source.description === 'string' ? source.description.slice(0, 12000) : '' }
      : {}),
    canReply: links(permissions).some((l) => l.method === 'post' && l.name === 'add'),
  });
}
function validateScalar(field: SdpFormField, part: unknown): void {
  let valid = true;
  if (field.kind === 'lookup') valid = isObject(part) && /^\d{1,30}$/.test(String(part.id));
  else if (['text', 'multiline', 'choice'].includes(field.kind))
    valid =
      typeof part === 'string' &&
      part.length <= field.maxLength &&
      part.length >= (field.minLength ?? 0);
  else if (field.kind === 'date' && field.dateOnly)
    valid =
      typeof part === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(part) &&
      Number.isFinite(Date.parse(part)) &&
      new Date(part).toISOString().slice(0, 10) === part;
  else if (['date', 'number'].includes(field.kind))
    valid =
      typeof part === 'number' &&
      Number.isFinite(part) &&
      (!field.integer || Number.isSafeInteger(part));
  else if (field.kind === 'boolean') valid = typeof part === 'boolean';
  if (!valid) throw new SdpProviderError('invalid');
  const key = (v: unknown) => (isObject(v) ? v.id : v);
  if (field.choices.length && !field.choices.some((c) => key(c.value) === key(part)))
    throw new SdpProviderError('invalid');
}
function validateFieldValue(field: SdpFormField, v: SdpFieldValue): void {
  const empty = v === null || v === '' || (Array.isArray(v) && !v.length);
  if (empty) {
    if (field.required) throw new SdpProviderError('invalid');
    return;
  }
  if (field.multiple !== Array.isArray(v)) throw new SdpProviderError('invalid');
  for (const part of Array.isArray(v) ? v : [v]) validateScalar(field, part);
}
export async function validateFormMutation(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpMutation,
) {
  if (mutation.kind === 'relation') {
    await validateRelation(provider, token, signal, mutation);
    return;
  }
  if (mutation.kind === 'reply' || mutation.kind === 'forward') {
    if (
      !(
        await readReplyContext(
          provider,
          token,
          signal,
          mutation.id,
          mutation.kind === 'forward',
          mutation.kind === 'forward' ? mutation.sourceId : undefined,
        )
      ).canReply
    )
      throw new SdpProviderError('denied');
    return;
  }
  if (mutation.kind !== 'edit') return;
  const form = await readForm(provider, token, signal, mutation.id);
  for (const [key, v] of Object.entries(mutation.fields)) {
    const field = form.fields.find((f) => f.key === key);
    if (!field || field.readOnly) throw new SdpProviderError('invalid');
    validateFieldValue(field, v);
  }
  return form;
}
function editedHtml(value: SdpFieldValue, html: (text: string) => string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new SdpProviderError('invalid');
  return html(value);
}
export function editedRequest(
  fields: Record<string, SdpFieldValue>,
  html: (text: string) => string,
  form?: SdpForm,
) {
  const request: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(fields)) {
    let result: unknown = v;
    if (key === 'description' || key === 'resolution.content') result = editedHtml(v, html);
    else if (
      (form?.fields.find((f) => f.key === key)?.kind === 'date' ||
        /(?:_time$|^udf_fields\.(?:udf_date\d+$|dt_|date_))/.test(key)) &&
      (typeof v === 'number' || typeof v === 'string')
    )
      result = { value: String(v) };
    else if (isObject(v)) result = { id: v.id };
    else if (Array.isArray(v)) result = v.map((item) => (isObject(item) ? { id: item.id } : item));
    const [parent = '', child] = key.split('.');
    if (child) {
      request[parent] ??= {};
      (request[parent] as Record<string, unknown>)[child] = result;
    } else request[parent] = result;
  }
  return request;
}
