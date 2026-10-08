import { scalarText, isObject, SdpProvider, SdpProviderError } from './SdpProvider';

const CATALOG_TTL_MS = 60 * 60_000;
type CachedCatalog = { expiresAt: number; fields: Promise<Record<string, unknown>> };
const catalogs = new WeakMap<SdpProvider, Map<string, CachedCatalog>>();

/**
 * Field definitions are setup metadata (names, types and limits), never ticket values. Opening each
 * ticket would otherwise re-read every page of them, so one read is shared per provider and access
 * token for an hour. A setup-scope denial is kept too; any other failure is read again.
 */
export function readCustomFieldCatalog(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  let byToken = catalogs.get(provider);
  if (!byToken) {
    byToken = new Map();
    catalogs.set(provider, byToken);
  }
  const now = Date.now();
  for (const [key, entry] of byToken) if (entry.expiresAt <= now) byToken.delete(key);
  const cached = byToken.get(token);
  if (cached) return cached.fields;
  const entry = { expiresAt: now + CATALOG_TTL_MS, fields: fetchCatalog(provider, token, signal) };
  byToken.set(token, entry);
  entry.fields.catch((error: unknown) => {
    const denied =
      error instanceof SdpProviderError &&
      error.kind === 'denied' &&
      [401, 403, 404].includes(error.httpStatus ?? 0);
    if (!denied && byToken.get(token) === entry) byToken.delete(token);
  });
  return entry.fields;
}

// Public request API types. Values and permissions always come from the live ticket.
// Cloud exposes custom definitions through the setup API, not the UI-only _metainfo.
async function fetchCatalog(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://support.campingworld.com/app/itdesk/api/v3/udf_fields');
    url.searchParams.set(
      'input_data',
      JSON.stringify({
        list_info: {
          start_index: page * 100 + 1,
          row_count: 100,
          fields_required: [
            'id',
            'field_key',
            'name',
            'type',
            'field_type',
            'constraints',
            'module',
            'reference_entity',
            'field_config',
          ],
          search_criteria: { field: 'module.name', condition: 'is', value: 'request' },
        },
      }),
    );
    const raw = await provider.json(
      url.href,
      signal,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
        },
      },
      1048576,
    );
    if (!isObject(raw) || !Array.isArray(raw.udf_fields) || !isObject(raw.list_info))
      throw new SdpProviderError('invalid');
    for (const field of raw.udf_fields) {
      if (!isObject(field) || !isObject(field.module) || field.module.name !== 'request') continue;
      const key = scalarText(field.field_key);
      if (!/^[a-z][a-z0-9_]{0,88}$/.test(key) || Object.hasOwn(fields, key))
        throw new SdpProviderError('invalid');
      fields[key] = customDefinition(field);
    }
    if (raw.list_info.has_more_rows === false) return fields;
    if (raw.list_info.has_more_rows !== true || !raw.udf_fields.length)
      throw new SdpProviderError('invalid');
  }
  throw new SdpProviderError('invalid');
}
function customDefinition(field: Record<string, unknown>): Record<string, unknown> {
  const constraints = Object.fromEntries(
    (Array.isArray(field.constraints) ? field.constraints : [])
      .filter(isObject)
      .filter((c) => typeof c.constraint_name === 'string')
      .map((c) => [String(c.constraint_name), c.constraint_value]),
  );
  const reference = field.type === 'refered_field';
  const multiple = field.type === 'multi_select' || constraints.collection === true;
  const type = reference ? 'lookup' : field.type;
  const supported = [
    'string',
    'multi_select',
    'lookup',
    'datetime',
    'datestamp',
    'long',
    'double',
    'boolean',
    'sequence_number',
  ].includes(String(type));
  return {
    type,
    display_name: field.name,
    display_type: field.field_type,
    multiple,
    constraints,
    editable: supported && type !== 'sequence_number',
  };
}
const lookups: Record<string, string[]> = {
  requester: [],
  on_behalf_of: [],
  status: [],
  priority: [],
  site: [],
  group: ['site'],
  technician: ['site', 'group'],
  request_type: [],
  category: [],
  subcategory: ['category'],
  item: ['subcategory'],
  impact: [],
  urgency: [],
  mode: [],
  level: [],
  assets: ['site'],
  configuration_items: [],
};
const labels: Record<string, string> = {
  request_type: 'Request type',
  on_behalf_of: 'On behalf of',
  due_by_time: 'Due by',
  first_response_due_by_time: 'First response due by',
  created_time: 'Created',
  'resolution.content': 'Resolution',
};
export function publicFieldInfo(
  key: string,
  current: unknown,
  templateDefault: unknown,
  options: unknown,
): Record<string, unknown> {
  const display_name =
    labels[key] ?? key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
  const multiple = Array.isArray(current) || Array.isArray(templateDefault);
  if (key in lookups)
    return {
      type: 'lookup',
      display_name,
      depends_on: lookups[key],
      multiple: ['assets', 'configuration_items'].includes(key),
    };
  if (['description', 'resolution.content'].includes(key)) return { type: 'html', display_name };
  if (['subject', 'update_reason'].includes(key)) return { type: 'string', display_name };
  if (key.endsWith('_time')) return { type: 'datetime', display_name };
  if (!key.startsWith('udf_fields.')) return {};
  const name = key.slice(11);
  return customFieldInfo(name, current ?? templateDefault, options, multiple);
}
/**
 * A custom field's label when SDP withholds field definitions (they need setup access). SDP names a
 * field after its label, so `txt_major_incident` reads "Major Incident"; generated names such as
 * `udf_char110` carry no words and stay as they are.
 */
export function customFieldLabel(name: string): string {
  const words = /^(?:txt|dt|date|num|dbl)_([a-z][a-z0-9_]*)$/.exec(name)?.[1];
  if (!words) return name;
  return words
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}
function customFieldInfo(
  name: string,
  sample: unknown,
  options: unknown,
  multiple: boolean,
): Record<string, unknown> {
  const display_name = customFieldLabel(name);
  if (Array.isArray(options) && options.length)
    return {
      type: isObject(options[0]) && options[0].id ? 'lookup' : 'string',
      display_name,
      multiple,
    };
  if (/^(udf_date\d+|dt_|date_)/.test(name)) return { type: 'datetime', display_name };
  if (/^(udf_(?:long|double)\d+|num_|dbl_)/.test(name)) return { type: 'double', display_name };
  if (/^udf_boolean\d+$/.test(name)) return { type: 'boolean', display_name };
  if (isObject(sample) && typeof sample.id === 'string')
    return { type: 'lookup', display_name, multiple };
  if (/^(udf_char\d+|txt_)/.test(name)) return { type: 'string', display_name, multiple };
  // Unknown custom types remain untouched rather than guessing a writable representation.
  return {};
}
