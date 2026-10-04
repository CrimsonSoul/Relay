import { describe, expect, it, vi } from 'vitest';
import type * as DynatraceAuthenticationModule from './DynatraceAuthentication';
import { readDynatracePlatform } from './DynatracePlatformRead';

const config = {
  environmentUrl: 'https://abc.apps.dynatrace.com',
  apiToken: 'private-token',
  alertingProfiles: null,
  customDqlMatcher: null,
};

describe('readDynatracePlatform', () => {
  it('keeps the HTTP error and its Retry-After when the error body has already failed', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 429, headers: { 'retry-after': '30' } }));
    await expect(
      readDynatracePlatform(
        fetchMock,
        config,
        '/platform/automation/v1/executions',
        new URLSearchParams(),
        new AbortController().signal,
        'automation:workflows:read',
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('HTTP 429'), cause: 30_000 });
  });
});

// Endpoint tests isolate authentication; OAuthIntegration covers the full exchange and transport path.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof DynatraceAuthenticationModule>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});
