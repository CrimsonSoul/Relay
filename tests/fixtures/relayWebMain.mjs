import process from 'node:process';

const { URL, URLSearchParams, Request, Response, Headers } = globalThis;

if (process.env.NODE_ENV !== 'test' || process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS !== '1') {
  throw new Error('The Relay Web fixture requires the isolated test runner.');
}

// Exercise production OAuth and privileged-command code without external credentials or tenant data.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === 'https://sso.dynatrace.com') {
    const body = new URLSearchParams(String(init?.body));
    const valid =
      url.pathname === '/sso/oauth2/token' &&
      init?.method === 'POST' &&
      body.get('grant_type') === 'client_credentials' &&
      body.get('client_id') === 'dt0s02.relay-web-test' &&
      body.get('resource') === 'urn:dtaccount:12345678-1234-1234-1234-123456789012' &&
      body.get('client_secret')?.startsWith('relay-web-test-secret-') &&
      body.get('scope')?.includes('environment-api:problems:read');
    return valid
      ? Response.json({
          access_token: 'relay-web-oauth-access',
          token_type: 'Bearer',
          expires_in: 300,
        })
      : Response.json({ error: 'invalid_client' }, { status: 401 });
  }
  if (url.origin === 'https://relay-web-e2e.apps.dynatrace.com') {
    if (new Headers(init?.headers).get('Authorization') !== 'Bearer relay-web-oauth-access') {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (url.pathname.endsWith('/problems')) {
      return url.searchParams.get('from') === '0'
        ? Response.json({ error: 'startTime must not be empty' }, { status: 400 })
        : Response.json({ totalCount: 0, problems: [] });
    }
    if (url.pathname.endsWith('query:execute'))
      return Response.json({ state: 'SUCCEEDED', result: { records: [] } });
    return Response.json({ error: 'unknown fixture endpoint' }, { status: 404 });
  }
  return originalFetch(input, init);
};

await import('../../dist/main/index.js');
