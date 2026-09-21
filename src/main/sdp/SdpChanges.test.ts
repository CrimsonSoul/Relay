import { expect, it, vi } from 'vitest';
import { readChanges } from './SdpChanges';
import { SdpProvider } from './SdpProvider';
it('reads a bounded scheduled window and projects only change correlation fields', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockResolvedValue({
    changes: [
      {
        id: '12',
        display_id: { display_value: 'CH 12' },
        title: 'Patch',
        description: '<p>db01</p>',
        status: { name: 'Open' },
        site: { name: 'Production' },
        scheduled_start_time: { value: '1000' },
        scheduled_end_time: { value: null },
        assets: [{ name: 'db01', secret: 'hidden' }],
        services: [{ name: 'Payments' }],
        udf_fields: { private: 'hidden' },
      },
    ],
    list_info: { has_more_rows: true },
  });
  const page = await readChanges(provider, 'token', new AbortController().signal, {
    action: 'readChanges',
    problemStart: 800000000,
    page: 1,
  });
  expect(page).toMatchObject({
    page: 1,
    hasMore: true,
    changes: [
      {
        id: '12',
        number: 'CH 12',
        scheduledStart: 1000,
        scheduledEnd: null,
        assets: ['db01'],
        services: ['Payments'],
      },
    ],
  });
  expect(JSON.stringify(page)).not.toContain('hidden');
  const url = new URL(json.mock.calls[0]![0]);
  expect(url.pathname).toBe('/app/itdesk/api/v3/changes');
  expect(JSON.parse(url.searchParams.get('input_data')!)).toMatchObject({
    list_info: {
      start_index: 51,
      row_count: 50,
      search_criteria: {
        field: 'scheduled_start_time',
        value: '195200000',
        children: [{ value: '800000000' }],
      },
    },
  });
  expect(json.mock.calls[0]![2]).toMatchObject({
    headers: { Authorization: 'Zoho-oauthtoken token' },
  });
});
it('rejects malformed records and unknown pagination rather than claiming complete coverage', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json');
  for (const value of [
    { changes: [] },
    { changes: [{ id: 'bad' }], list_info: { has_more_rows: false } },
    { changes: [{ id: '1', assets: {} }], list_info: { has_more_rows: false } },
  ]) {
    json.mockResolvedValue(value);
    await expect(
      readChanges(provider, 'token', new AbortController().signal, {
        action: 'readChanges',
        problemStart: 10000,
        page: 0,
      }),
    ).rejects.toThrow();
  }
});

it('hydrates omitted affected systems from bounded detail reads and labels incomplete coverage', async () => {
  const provider = new SdpProvider();
  const start = 10000000;
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    title: 'Patch',
    scheduled_start_time: { value: String(start - 1000) },
    scheduled_end_time: { value: String(start + 1000) },
  }));
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url) => {
    const id = new URL(url).pathname.split('/').at(-1)!;
    if (id === 'changes') return { changes: rows, list_info: { has_more_rows: false } };
    return {
      change: {
        ...rows[Number(id) - 1],
        assets: [{ name: 'db01.prod.test' }],
        services: [{ name: 'Payments' }],
        configuration_items: [{ name: 'db02.prod.test' }],
      },
    };
  });
  const result = await readChanges(provider, 'token', new AbortController().signal, {
    action: 'readChanges',
    problemStart: start,
    page: 0,
  });
  expect(json).toHaveBeenCalledTimes(11);
  expect(result.detailsComplete).toBe(false);
  expect(result.changes[0]).toMatchObject({
    assets: ['db01.prod.test'],
    services: ['Payments'],
    configurationItems: ['db02.prod.test'],
  });
  expect(result.changes[11]?.assets).toEqual([]);
  expect(
    json.mock.calls
      .slice(1)
      .every(([url]) =>
        url.startsWith('https://support.campingworld.com/app/itdesk/api/v3/changes/'),
      ),
  ).toBe(true);
});
it('rejects a detail returned for another change', async () => {
  const provider = new SdpProvider();
  vi.spyOn(provider, 'json')
    .mockResolvedValueOnce({
      changes: [{ id: '1', scheduled_start_time: { value: '1000' } }],
      list_info: { has_more_rows: false },
    })
    .mockResolvedValueOnce({ change: { id: '2' } });
  await expect(
    readChanges(provider, 'token', new AbortController().signal, {
      action: 'readChanges',
      problemStart: 2000,
      page: 0,
    }),
  ).rejects.toThrow();
});
