import { describe, expect, it, vi } from 'vitest';
import { SdpBulkMutationSchema } from '@shared/sdpMutation';
import {
  prepareBulk,
  confirmBulk,
  SdpBulkDeniedError,
  SdpBulkNotAppliedError,
  SdpBulkRejectedError,
} from './SdpBulk';
import { SdpFormUnavailableError } from './SdpForms';
import { SdpProvider, SdpProviderError, SdpValidationError } from './SdpProvider';
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
/** Tickets on a template whose technician layout makes Resolution and Group mandatory. */
function formSetup(resolutions: Record<string, string>) {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    const path = new URL(url).pathname;
    if (init?.method) return { response_status: { status_code: 2000 }, request: { id: '1' } };
    if (path.endsWith('/_links')) return { _links: [{ name: 'edit', method: 'put' }] };
    if (path.endsWith('/udf_fields'))
      return { udf_fields: [], list_info: { has_more_rows: false } };
    if (path.endsWith('/_allowed_values_for_fields')) return { allowed_values: {} };
    if (path.endsWith('/_get_template_with_layout'))
      return {
        request_template: {
          layouts: [
            {
              name: 'technician_layout',
              sections: [
                {
                  name: 'Details',
                  fields: ['status', 'group', 'priority', 'resolution.content'].map((name) => ({
                    name,
                    mandatory: name !== 'priority',
                  })),
                },
              ],
            },
          ],
        },
      };
    const id = path.split('/').at(-1)!;
    return {
      request: {
        id,
        display_id: `D${id}`,
        template: { id: '7', name: 'Incident' },
        status: { id: '1', name: 'Open' },
        group: { id: '9', name: 'Network' },
        priority: null,
        resolution: { content: resolutions[id] ?? '' },
      },
    };
  });
  const formReads = () =>
    json.mock.calls.filter((call) => call[0].endsWith('/_get_template_with_layout')).length;
  return { provider, json, formReads };
}
describe('reviewed bulk ticket updates', () => {
  it('rejects duplicate IDs, oversized batches and empty changes', () => {
    for (const invalid of [
      { ...mutation, ids: ['123', '123'] },
      { ...mutation, ids: Array.from({ length: 101 }, (_, i) => String(i)) },
      { ...mutation, fields: {} },
    ])
      expect(SdpBulkMutationSchema.safeParse(invalid).success).toBe(false);
    // One full 100-row queue page fits in one reviewed batch.
    expect(
      SdpBulkMutationSchema.safeParse({
        ...mutation,
        ids: Array.from({ length: 100 }, (_, i) => String(i)),
      }).success,
    ).toBe(true);
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
  it('confirms a timed-out write that a re-read shows applied and continues the batch', async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    const original = json.getMockImplementation()!;
    let landed = false;
    json.mockImplementation(async (...args) => {
      if (args[2]?.method && args[0].endsWith('/456')) {
        landed = true;
        throw new SdpProviderError('outage');
      }
      // The verification read sees SDP's applied values; baselines before the write are unchanged.
      if (landed && !args[2]?.method && args[0].endsWith('/456'))
        return { request: { id: '456', status: { name: 'Closed' }, group: null } };
      return original(...args);
    });
    const results = await confirmBulk(provider, 'token', signal, mutation, baseline, () => {});
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(json.mock.calls.filter((c) => c[2]?.method).map((c) => c[0].split('/').at(-1))).toEqual([
      '123',
      '456',
      '789',
    ]);
  });
  it('stops with a definite outcome when a re-read shows SDP kept the earlier values', async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    const original = json.getMockImplementation()!;
    json.mockImplementation(async (...args) => {
      if (args[2]?.method && args[0].endsWith('/456')) throw new SdpProviderError('outage');
      return original(...args);
    });
    const failure = await confirmBulk(
      provider,
      'token',
      signal,
      mutation,
      baseline,
      () => {},
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SdpBulkNotAppliedError);
    expect((failure as SdpBulkNotAppliedError).message).toContain('SDP did not apply the change');
    expect((failure as SdpBulkNotAppliedError).results.map((r) => r.status)).toEqual([
      'confirmed',
      'not-attempted',
      'not-attempted',
    ]);
    expect(json.mock.calls.filter((c) => c[2]?.method)).toHaveLength(2);
  });
  it("stops with SDP's field list when SDP rejects a write as invalid", async () => {
    const { provider, json } = setup();
    const baseline = await prepareBulk(provider, 'token', signal, mutation, () => {});
    const original = json.getMockImplementation()!;
    json.mockImplementation(async (...args) => {
      if (args[2]?.method && args[0].endsWith('/456')) throw new SdpValidationError(['resolution']);
      return original(...args);
    });
    const failure = await confirmBulk(
      provider,
      'token',
      signal,
      mutation,
      baseline,
      () => {},
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SdpBulkRejectedError);
    expect((failure as SdpBulkRejectedError).message).toBe(
      'SDP rejected the change. Check these fields: resolution. Refresh the ticket before preparing a new change. The batch stopped at that ticket; every ticket not marked confirmed is unchanged.',
    );
    expect((failure as SdpBulkRejectedError).results.map((r) => r.status)).toEqual([
      'confirmed',
      'not-attempted',
      'not-attempted',
    ]);
    // A rejection is definite: no verification read, retry or later ticket follows it.
    expect(json.mock.calls.filter((c) => c[2]?.method).map((c) => c[0].split('/').at(-1))).toEqual([
      '123',
      '456',
    ]);
    const single = { ...mutation, ids: ['456'] };
    const one = await confirmBulk(
      provider,
      'token',
      signal,
      single,
      await prepareBulk(provider, 'token', signal, single, () => {}),
      () => {},
    ).catch((error: unknown) => error);
    expect((one as SdpBulkRejectedError).message).toBe(
      new SdpValidationError(['resolution']).message,
    );
  });
  it('refuses to prepare a close that leaves a required field empty, naming it', async () => {
    const { provider, json, formReads } = formSetup({ '123': '<p>Fixed</p>' });
    const closing = {
      kind: 'bulk' as const,
      ids: ['123', '456', '789'],
      fields: { status: 'Closed' },
    };
    await expect(prepareBulk(provider, 'token', signal, closing, () => {})).rejects.toThrow(
      new SdpFormUnavailableError(
        'Ticket #D456 cannot be closed yet: SDP requires Resolution. Open the ticket, fill in the missing fields, then close it.',
      ),
    );
    // The batch prepares as one review: the first failing ticket stops it and nothing is sent.
    expect(formReads()).toBe(2);
    expect(json.mock.calls.some((call) => call[2]?.method)).toBe(false);
    // A change that clears a required field cannot satisfy it either.
    await expect(
      prepareBulk(
        provider,
        'token',
        signal,
        { kind: 'bulk', ids: ['123'], fields: { status: 'Resolved', group: null } },
        () => {},
      ),
    ).rejects.toThrow('Ticket #D123 cannot be resolved yet: SDP requires Group.');
  });
  it('prepares a close whose required fields are filled or supplied by the change', async () => {
    const { provider, formReads } = formSetup({ '123': '<p>Fixed</p>' });
    await expect(
      prepareBulk(
        provider,
        'token',
        signal,
        { kind: 'bulk', ids: ['123', '456'], fields: { status: 'Closed', resolution: 'Done' } },
        () => {},
      ),
    ).resolves.toBeTypeOf('string');
    await expect(
      prepareBulk(
        provider,
        'token',
        signal,
        { kind: 'bulk', ids: ['123'], fields: { status: 'Closed' } },
        () => {},
      ),
    ).resolves.toBeTypeOf('string');
    expect(formReads()).toBe(3);
  });
  it('reads no form for a change that does not close the ticket', async () => {
    const { provider, formReads } = formSetup({});
    await prepareBulk(
      provider,
      'token',
      signal,
      { kind: 'bulk', ids: ['123', '456'], fields: { status: 'In Progress', group: null } },
      () => {},
    );
    expect(formReads()).toBe(0);
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
