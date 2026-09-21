import { describe, expect, it, vi } from 'vitest';
import { SdpBulkMutationSchema } from '@shared/sdpMutation';
import { prepareBulk, confirmBulk, SdpBulkDeniedError } from './SdpBulk';
import { SdpProvider, SdpProviderError } from './SdpProvider';
const signal = new AbortController().signal;
const mutation = SdpBulkMutationSchema.parse({
  kind: 'bulk',
  ids: ['123', '456', '789'],
  fields: { status: 'Closed', group: null },
});
function setup() {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    const id = new URL(url).pathname.split('/').at(-1);
    return init?.method
      ? { response_status: { status_code: 2000 }, request: { id } }
      : { request: { id, status: { name: 'Open' } } };
  });
  return { provider, json };
}
describe('reviewed bulk ticket updates', () => {
  it('rejects duplicate IDs, oversized batches and empty changes', () => {
    for (const invalid of [
      { ...mutation, ids: ['123', '123'] },
      { ...mutation, ids: Array.from({ length: 21 }, (_, i) => String(i)) },
      { ...mutation, fields: {} },
    ])
      expect(SdpBulkMutationSchema.safeParse(invalid).success).toBe(false);
  });
  it('prepares without writes, confirms sequentially and maps each result', async () => {
    const { provider, json } = setup();
    const current = vi.fn();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, current);
    expect(json.mock.calls.every((call) => !call[2]?.method)).toBe(true);
    const result = await confirmBulk(provider, 'token', signal, mutation, baseline, current);
    expect(result.map((r) => r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    const writes = json.mock.calls.filter((call) => call[2]?.method);
    expect(writes).toHaveLength(3);
    expect(
      JSON.parse(new URLSearchParams(writes[0]![2]!.body as string).get('input_data')!),
    ).toEqual({ request: { status: { name: 'Closed' }, group: null } });
  });
  it('preflights the whole batch and writes nothing when any ticket changed', async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    json.mockImplementation(async (url) => ({
      request: { id: new URL(url).pathname.split('/').at(-1), status: { name: 'Changed' } },
    }));
    const results = await confirmBulk(provider, 'token', signal, mutation, baseline, () => {});
    expect(results[0]!.status).toBe('conflict');
    expect(json.mock.calls.some((call) => call[2]?.method)).toBe(false);
  });
  it('stops after an ambiguous write and never retries or sends later tickets', async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    const original = json.getMockImplementation()!;
    json.mockImplementation(async (...args) => {
      if (args[2]?.method && args[0].endsWith('/456')) throw new Error('timeout');
      return original(...args);
    });
    const results = await confirmBulk(provider, 'token', signal, mutation, baseline, () => {});
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'uncertain', 'not-attempted']);
    expect(json.mock.calls.filter((c) => c[2]?.method).map((c) => c[0].split('/').at(-1))).toEqual([
      '123',
      '456',
    ]);
  });
  it('carries partial results with permission denial so the broker revokes the session', async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    const original = json.getMockImplementation()!;
    json.mockImplementation(async (...args) => {
      if (args[2]?.method) throw new SdpProviderError('denied');
      return original(...args);
    });
    await expect(
      confirmBulk(provider, 'token', signal, mutation, baseline, () => {}),
    ).rejects.toMatchObject({
      results: [
        { id: '123', status: 'uncertain' },
        { id: '456', status: 'not-attempted' },
        { id: '789', status: 'not-attempted' },
      ],
    });
    expect(SdpBulkDeniedError.prototype).toBeInstanceOf(SdpProviderError);
  });
});
