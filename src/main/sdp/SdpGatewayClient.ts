import type PocketBase from 'pocketbase';
import {
  SDP_DEVICE_HEADER,
  SDP_FEATURES_HEADER,
  SDP_SERVER_UPDATE_MESSAGE,
  SDP_ACCEPTED_FEATURES,
  SdpBrokerReplySchema,
  SDP_DISCOVERY_COLLECTION,
  SDP_DISCOVERY_ID,
  type SdpBackend,
  type SdpBrokerCommand,
  type SdpBrokerReply,
} from '@shared/sdpAccount';
import type { ClientConfig } from '../config/AppConfig';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import { safePocketBaseAuthFailure } from '../app/pbErrors';
import { loggers } from '../logger';

class RelayRequestError extends Error {
  constructor(
    readonly status: number,
    /** How long a rate-limited (429) request asks to wait; unknown waits are unbounded. */
    readonly retryAfterMs = Number.POSITIVE_INFINITY,
  ) {
    super('Relay request failed.');
  }
}
/** The longest rate-limit wait a read sits out before reporting the failure. */
const RATE_LIMIT_RETRY_MS = 5_000;
/**
 * The gateway refuses a rate-limited request before the broker runs it, so a read can wait out a
 * short limit and try once more. Status and refresh checks repeat on their own schedule instead.
 */
function retriesRateLimit(command: SdpBrokerCommand, error: unknown): error is RelayRequestError {
  return (
    error instanceof RelayRequestError &&
    error.status === 429 &&
    error.retryAfterMs <= RATE_LIMIT_RETRY_MS &&
    (command.action.startsWith('read') || command.action === 'searchTickets')
  );
}

/** Every command this client sends is valid here, so a 400 means the server predates it. */
function failureMessage(error: unknown): string {
  if (!(error instanceof RelayRequestError))
    return 'The Relay server connection is unavailable. Try again shortly.';
  return error.status === 400 ? SDP_SERVER_UPDATE_MESSAGE : 'SDP could not complete this action.';
}
/** Native transport uses the existing workspace connection, never an SDP credential. */
export class SdpGatewayClient implements SdpBackend {
  private pending: Promise<unknown> = Promise.resolve();
  private cookie = '';
  private csrf = '';
  private origin = '';
  private owner = '';
  private lastFailure = '';
  constructor(
    private readonly context: () =>
      Promise<{ config: ClientConfig; pb: PocketBase }> | { config: ClientConfig; pb: PocketBase },
    private readonly fetchImpl: typeof fetch = fetch,
    /** This desktop's device key; the server remembers its SDP sign-in under it. */
    private readonly device?: () => string,
  ) {}
  /** Session setup is serialized; commands then run concurrently, as they do over local IPC. */
  async invoke(
    command: SdpBrokerCommand,
    options?: { keepSignIn?: boolean },
  ): Promise<SdpBrokerReply> {
    const ready = this.pending.then(() => this.prepare());
    this.pending = ready.catch(() => undefined);
    let cookie = '';
    try {
      if (!(await ready)) return { view: { configured: false, status: 'disconnected' } };
      cookie = this.cookie;
      const response = await this.send(command, !options?.keepSignIn);
      const reply = SdpBrokerReplySchema.parse(await this.json(response));
      this.lastFailure = '';
      return reply;
    } catch (error) {
      this.logFailure(cookie ? 'request' : 'setup', error);
      // Keep the Relay session (and its server-side SDP sign-in) through broker errors, rate limits
      // and network blips; a restarted server answers 401 next time. Only a rejected session is
      // dropped. The owner/origin checks in prepare() prevent reusing a previous user's session.
      const rejected =
        error instanceof RelayRequestError && (error.status === 401 || error.status === 403);
      if (this.cookie && !rejected) throw new Error(failureMessage(error));
      if (this.cookie === cookie) {
        this.cookie = '';
        this.csrf = '';
      }
      throw new Error('The Relay server connection is unavailable. Reconnect and sign in again.');
    }
  }
  private async send(command: SdpBrokerCommand, device: boolean): Promise<Response> {
    // A bulk confirmation checks and writes each ticket in turn; up to 100 can take minutes.
    const timeout =
      command.action === 'confirmChange' || command.action === 'prepareChange' ? 600_000 : 90_000;
    try {
      return await this.request('/sdp/account', command, timeout, device);
    } catch (error) {
      if (!retriesRateLimit(command, error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs));
      return this.request('/sdp/account', command, timeout, device);
    }
  }
  /** Status checks repeat every few seconds, so only a changed failure is logged, as metadata only. */
  private logFailure(stage: 'request' | 'setup', error: unknown): void {
    const failure = {
      stage,
      error: error instanceof Error ? error.name : typeof error,
      ...safePocketBaseAuthFailure(error),
    };
    const signature = JSON.stringify(failure);
    if (signature !== this.lastFailure)
      loggers.main.warn('SDP request through the Relay server failed', failure);
    this.lastFailure = signature;
  }
  private async prepare(): Promise<boolean> {
    const { config, pb } = await this.context();
    const owner = `${config.serverUrl}\0${config.secret}`;
    if (owner !== this.owner) {
      this.cookie = '';
      this.csrf = '';
      this.owner = owner;
    }
    const discovery = await pb
      .collection(SDP_DISCOVERY_COLLECTION)
      .getOne(SDP_DISCOVERY_ID, { requestKey: null })
      .catch((error: unknown) => {
        // This collection is readable only when signed in, so PocketBase reports a rejected token as
        // a missing record. Dropping the token makes the next attempt sign in again.
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0))
          pb.authStore.clear();
        throw error;
      });
    if (!discovery.enabled) {
      this.cookie = '';
      return false;
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
    return true;
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
  private async request(
    path: string,
    body: unknown,
    timeoutMs = 90_000,
    device = false,
  ): Promise<Response> {
    const response = await this.fetchImpl(`${this.origin}${RELAY_WEB_API_PREFIX}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Origin: this.origin,
        [SDP_FEATURES_HEADER]: SDP_ACCEPTED_FEATURES,
        ...(device && this.device ? { [SDP_DEVICE_HEADER]: this.device() } : {}),
        ...(this.cookie ? { Cookie: this.cookie, 'X-Relay-CSRF': this.csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new RelayRequestError(
        response.status,
        retryAfter > 0 ? retryAfter * 1_000 : Number.POSITIVE_INFINITY,
      );
    }
    return response;
  }
}
