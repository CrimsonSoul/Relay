import type PocketBase from 'pocketbase';
import {
  SdpBrokerReplySchema,
  SDP_DISCOVERY_COLLECTION,
  SDP_DISCOVERY_ID,
  type SdpBackend,
  type SdpBrokerCommand,
  type SdpBrokerReply,
} from '@shared/sdpAccount';
import type { ClientConfig } from '../config/AppConfig';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';

/** Native transport uses the existing workspace connection, never an SDP credential. */
export class SdpGatewayClient implements SdpBackend {
  private pending: Promise<unknown> = Promise.resolve();
  private cookie = '';
  private csrf = '';
  private origin = '';
  private owner = '';
  constructor(
    private readonly context: () => { config: ClientConfig; pb: PocketBase },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  invoke(command: SdpBrokerCommand): Promise<SdpBrokerReply> {
    const result = this.pending.then(() => this.perform(command));
    this.pending = result.catch(() => undefined);
    return result;
  }
  private async perform(command: SdpBrokerCommand): Promise<SdpBrokerReply> {
    const { config, pb } = this.context();
    const owner = `${config.serverUrl}\0${config.secret}`;
    if (owner !== this.owner) {
      this.cookie = '';
      this.csrf = '';
      this.owner = owner;
    }
    try {
      const discovery = await pb
        .collection(SDP_DISCOVERY_COLLECTION)
        .getOne(SDP_DISCOVERY_ID, { requestKey: null });
      if (!discovery.enabled) {
        this.cookie = '';
        return { view: { configured: false, status: 'disconnected' } };
      }
      const port: unknown = discovery.gatewayPort;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Invalid gateway configuration.');
      const url = new URL(config.serverUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid Relay address.');
      url.port = String(port);
      if (this.origin !== url.origin) {
        this.cookie = '';
        this.csrf = '';
        this.origin = url.origin;
      }
      if (!this.cookie) {
        const login = await this.request('/session/login', { passphrase: config.secret });
        const body = (await this.json(login)) as { session?: { csrfToken?: string } };
        const cookie = login.headers.get('set-cookie')?.split(';')[0];
        if (!cookie?.startsWith('relay_web_session=') || !body.session?.csrfToken)
          throw new Error('Relay session unavailable.');
        this.cookie = cookie;
        this.csrf = body.session.csrfToken;
      }
      const response = await this.request('/sdp/account', command);
      return SdpBrokerReplySchema.parse(await this.json(response));
    } catch {
      // Do not silently reauthenticate and reuse a previous user's cached projection.
      this.cookie = '';
      this.csrf = '';
      throw new Error('The Relay server connection is unavailable. Reconnect and sign in again.');
    }
  }
  private async json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty Relay response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 15 * 1024 * 1024) throw new Error('Relay response too large.');
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  private async request(path: string, body: unknown): Promise<Response> {
    const response = await this.fetchImpl(`${this.origin}${RELAY_WEB_API_PREFIX}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
      headers: {
        'Content-Type': 'application/json',
        Origin: this.origin,
        ...(this.cookie ? { Cookie: this.cookie, 'X-Relay-CSRF': this.csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Relay request failed.');
    }
    return response;
  }
}
