import { expect, it, vi } from 'vitest';
import { readCustomFieldCatalog } from './SdpFieldCatalog';
import { SdpProvider } from './SdpProvider';

const definition = (field_key: string, type: string, field_type: string, extra = {}) => ({
  field_key,
  type,
  field_type,
  name: 'Human label',
  module: { name: 'request' },
  ...extra,
});
it('reads paginated Cloud definitions with constraints, ignores other modules and never follows metadata URLs', async () => {
  const provider = new SdpProvider();
  const json = vi
    .spyOn(provider, 'json')
    .mockResolvedValueOnce({
      udf_fields: [
        definition('udf_char23', 'string', 'Single Line', {
          constraints: [{ constraint_name: 'max_length', constraint_value: '25' }],
          href: 'https://untrusted.invalid',
        }),
        definition('udf_char23', 'string', 'Single Line', { module: { name: 'change' } }),
        definition('udf_char130', 'string', 'Multi Line'),
        definition('udf_char102', 'multi_select', 'Check Box'),
      ],
      list_info: { has_more_rows: true },
    })
    .mockResolvedValueOnce({
      udf_fields: [
        definition('ref_people', 'refered_field', 'Multi Select Reference Entity', {
          constraints: [{ constraint_name: 'collection', constraint_value: true }],
        }),
        definition('udf_datestamp1', 'datestamp', 'Datestamp'),
        definition('udf_long1', 'long', 'Numeric Field'),
        definition('udf_boolean1', 'boolean', 'Decision Box'),
        definition('auto_number', 'sequence_number', 'Auto Number Field'),
        definition('unknown', 'future_type', 'Future Field'),
      ],
      list_info: { has_more_rows: false },
    });
  const fields = await readCustomFieldCatalog(provider, 'token', AbortSignal.timeout(1000));
  expect(fields.udf_char23).toMatchObject({
    display_name: 'Human label',
    constraints: { max_length: '25' },
  });
  expect(fields.udf_char130).toMatchObject({ display_type: 'Multi Line' });
  expect(fields.udf_char102).toMatchObject({ multiple: true });
  expect(fields.ref_people).toMatchObject({ type: 'lookup', multiple: true });
  expect(fields.udf_datestamp1).toMatchObject({ type: 'datestamp' });
  expect(fields.auto_number).toMatchObject({ editable: false });
  expect(fields.unknown).toMatchObject({ editable: false });
  for (const [index, [url]] of json.mock.calls.entries()) {
    expect(new URL(url).origin).toBe('https://support.campingworld.com');
    expect(new URL(url).pathname).toBe('/app/itdesk/api/v3/udf_fields');
    expect(JSON.parse(new URL(url).searchParams.get('input_data')!).list_info).toMatchObject({
      start_index: index * 100 + 1,
      search_criteria: { field: 'module.name', condition: 'is', value: 'request' },
      fields_required: expect.arrayContaining(['constraints']),
    });
  }
});
it.each([
  { udf_fields: [], list_info: { has_more_rows: true } },
  { udf_fields: [], list_info: {} },
  {
    udf_fields: [
      definition('same', 'string', 'Single Line'),
      definition('same', 'string', 'Single Line'),
    ],
    list_info: { has_more_rows: false },
  },
])('rejects incomplete or ambiguous definitions', async (raw) => {
  const provider = new SdpProvider();
  vi.spyOn(provider, 'json').mockResolvedValue(raw);
  await expect(
    readCustomFieldCatalog(provider, 'token', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ kind: 'invalid' });
});
