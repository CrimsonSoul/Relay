import { expect, it, vi } from 'vitest';
import { readHistory } from './SdpHistory';
import { SdpProvider } from './SdpProvider';
it('reads paginated Cloud history without following provider links or losing changes', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockResolvedValue({
    history: [
      {
        id: '7',
        by: { name: 'Operator', photo_url: 'https://untrusted.test' },
        time: { value: '1789752022731' },
        operation: 'edit',
        description: '<img src=x onerror=evil()>',
        diff: [
          { field: 'status', previous_value: { name: 'Open' }, current_value: { name: 'Closed' } },
          { field: 'technician', previous_value: null, current_value: { name: 'Example' } },
        ],
      },
    ],
    list_info: { has_more_rows: true },
  });
  const result = await readHistory(provider, 'token', new AbortController().signal, {
    action: 'readHistory',
    id: '123',
    page: 2,
  });
  const url = new URL(json.mock.calls[0]![0]);
  expect(url.pathname).toBe('/app/itdesk/api/v3/requests/123/_history');
  expect(JSON.parse(url.searchParams.get('input_data')!).list_info.start_index).toBe(101);
  expect(result.entries[0]!.changes).toEqual([
    { field: 'status', before: 'Open', after: 'Closed' },
    { field: 'technician', before: '', after: 'Example' },
  ]);
  expect(JSON.stringify(result)).not.toContain('untrusted.test');
  expect(result.hasMore).toBe(true);
});
it('rejects malformed history instead of reporting an empty successful page', async () => {
  const provider = new SdpProvider();
  vi.spyOn(provider, 'json').mockResolvedValue({ history: {} });
  await expect(
    readHistory(provider, 'token', new AbortController().signal, {
      action: 'readHistory',
      id: '123',
      page: 0,
    }),
  ).rejects.toThrow();
});

it('omits invalid provider timestamps so history remains renderable', async () => {
  const provider = new SdpProvider();
  vi.spyOn(provider, 'json').mockResolvedValue({
    history: [{ id: '1', time: { value: '1e30' } }],
  });
  const result = await readHistory(provider, 'token', new AbortController().signal, {
    action: 'readHistory',
    id: '123',
    page: 0,
  });
  expect(result.entries[0]!.at).toBeNull();
});

it('formats structured history values without leaking object coercion', async () => {
  const provider = new SdpProvider();
  vi.spyOn(provider, 'json').mockResolvedValue({
    history: [
      {
        id: '1',
        diff: [
          {
            field: 'values',
            previous_value: [true, 3, { name: 'NOC' }],
            current_value: { unrelated: 'hidden' },
          },
        ],
      },
    ],
  });
  const result = await readHistory(provider, 'token', new AbortController().signal, {
    action: 'readHistory',
    id: '123',
    page: 0,
  });
  expect(result.entries[0]!.changes).toEqual([
    { field: 'values', before: 'true, 3, NOC', after: '' },
  ]);
});
