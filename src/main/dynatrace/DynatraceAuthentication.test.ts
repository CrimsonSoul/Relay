import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynatraceAuthentication, dynatraceAuthenticationKey } from './DynatraceAuthentication';

const config = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: '',
  oauth: {
    clientId: 'dt0s02.client',
    clientSecret: 'private-client-secret',
    accountUuid: '12345678-1234-1234-1234-123456789012',
  },
  alertingProfiles: null,
  customDqlMatcher: null,
};
const tokenResponse = (token = 'short-lived-access-token', expires = 300) =>
  Response.json({ access_token: token, token_type: 'Bearer', expires_in: expires });

afterEach(() => vi.useRealTimers());

describe('Dynatrace OAuth authentication', () => {
  it('exchanges client credentials only at Dynatrace SSO and shares the unexpired token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse());
    const auth = new DynatraceAuthentication(fetchMock);
    const values = await Promise.all([auth.token(config), auth.token(config)]);
    expect(values).toEqual(['short-lived-access-token', 'short-lived-access-token']);
    await expect(auth.token(config)).resolves.toBe('short-lived-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://sso.dynatrace.com/sso/oauth2/token');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe(config.oauth.clientId);
    expect(body.get('client_secret')).toBe(config.oauth.clientSecret);
    expect(body.get('resource')).toBe(`urn:dtaccount:${config.oauth.accountUuid}`);
    expect(body.get('scope')).toContain('environment-api:problems:read');
    expect(body.get('scope')).not.toContain('environment:roles:viewer');
  });

  it('renews before expiry and never reuses tokens after credential or environment changes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => tokenResponse());
    const auth = new DynatraceAuthentication(fetchMock);
    await auth.token(config);
    vi.advanceTimersByTime(271_000);
    await auth.token(config);
    await auth.token({ ...config, oauth: { ...config.oauth, clientSecret: 'replacement' } });
    await auth.token({ ...config, environmentUrl: 'https://other.apps.dynatrace.com' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(dynatraceAuthenticationKey(config)).not.toContain('private-client-secret');
  });

  it('invalidates the cached access token when cleared', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => tokenResponse());
    const auth = new DynatraceAuthentication(fetchMock);
    await auth.token(config);
    auth.clear();
    await auth.token(config);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks legacy platform tokens before any network request and explains the OAuth migration', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const auth = new DynatraceAuthentication(fetchMock);
    await expect(
      auth.token({ ...config, oauth: undefined, apiToken: 'dt0s16.existing' }),
    ).rejects.toThrow(/requires OAuth setup/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    Response.json(
      { error: 'invalid_client', error_description: 'private-client-secret' },
      { status: 401 },
    ),
    Response.json(
      { error: 'invalid_scope', error_description: 'private-client-secret' },
      { status: 400 },
    ),
    new Response('private-client-secret: not JSON'),
    tokenResponse('bad token\r\nheader'),
    tokenResponse('token', 0),
    new Response('x'.repeat(70_000)),
  ])('rejects failed or malformed responses without exposing credentials', async (response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const auth = new DynatraceAuthentication(fetchMock);
    const error = await auth.token(config).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('OAuth');
    expect(String(error)).not.toContain('private-client-secret');
    await expect(auth.token(config)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets one caller cancel without cancelling another caller’s shared exchange', async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const auth = new DynatraceAuthentication(fetchMock);
    const controller = new AbortController();
    const cancelled = auth.token(config, controller.signal);
    const active = auth.token(config);
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    resolve(tokenResponse());
    await expect(active).resolves.toBe('short-lived-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
