import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { SDP_CALLBACK, type SdpBrokerCommand, type SdpBrokerReply } from '@shared/sdpAccount';
import { SdpAccountSession } from './SdpAccountSession';
const sessions: SdpAccountSession[] = [];
function setup() {
  const open = vi.fn(async (_url: string) => {});
  const invoke = vi.fn(async (command: SdpBrokerCommand): Promise<SdpBrokerReply> => {
    if (command.action === 'begin') {
      const url = new URL('https://accounts.zoho.com/oauth/v2/auth');
      url.search = new URLSearchParams({
        state: command.state,
        redirect_uri: SDP_CALLBACK,
      }).toString();
      return { view: { configured: true, status: 'connecting' }, authorizationUrl: url.toString() };
    }
    return {
      view: {
        configured: true,
        status: command.action === 'complete' ? 'connected' : 'disconnected',
      },
    };
  });
  const account = new SdpAccountSession(open, { invoke });
  sessions.push(account);
  return { open, invoke, account };
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((account) => account.disconnect()));
});
describe('native SDP sign-in callback', () => {
  it('sends a bound PKCE callback to the server without client credentials', async () => {
    const { account, invoke, open } = setup();
    await account.connect();
    const authorization = new URL(open.mock.calls[0]![0]);
    const response = await fetch(
      `${SDP_CALLBACK}?state=${authorization.searchParams.get('state')}&code=dummy`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('SDP connected');
    const begin = invoke.mock.calls.find(([command]) => command.action === 'begin')![0];
    const complete = invoke.mock.calls.find(([command]) => command.action === 'complete')![0];
    if (begin.action !== 'begin' || complete.action !== 'complete')
      throw new Error('Missing proof');
    expect(createHash('sha256').update(complete.verifier).digest('base64url')).toBe(
      begin.challenge,
    );
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('clientSecret');
  });
  it('rejects wrong state, duplicate parameters, wrong region and provider errors', async () => {
    const { account, invoke, open } = setup();
    await account.connect();
    const state = new URL(open.mock.calls[0]![0]).searchParams.get('state');
    for (const query of [
      'state=bad&code=dummy',
      `state=${state}&state=${state}&code=dummy`,
      `state=${state}&code=dummy&location=eu`,
    ]) {
      const response = await fetch(`${SDP_CALLBACK}?${query}`);
      expect(response.status).toBe(400);
      await response.text();
    }
    expect(invoke.mock.calls.some(([command]) => command.action === 'complete')).toBe(false);
  });
  it('fails closed on an occupied callback port', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(8766, '127.0.0.1', resolve));
    try {
      const { account, open } = setup();
      await expect(account.connect()).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('never opens an untrusted authorization destination', async () => {
    const { account, invoke, open } = setup();
    invoke.mockImplementation(async () => ({
      view: { configured: true, status: 'connecting' },
      authorizationUrl: 'https://evil.example/',
    }));
    await expect(account.connect()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
