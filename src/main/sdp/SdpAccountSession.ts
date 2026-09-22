import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import {
  SDP_CALLBACK,
  type SdpAccountView,
  type SdpBackend,
  type SdpBrokerCommand,
} from '@shared/sdpAccount';
import { SDP_ACCOUNTS } from './SdpProvider';

/** Native loopback callback only. Provider credentials and ticket storage belong to the server. */
export class SdpAccountSession {
  private listener?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly backend: SdpBackend,
  ) {}
  private stop(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.listener?.close();
    this.listener?.closeAllConnections();
    this.listener = undefined;
  }
  async status(): Promise<SdpAccountView> {
    return this.invoke({ action: 'status' });
  }
  async disconnect(): Promise<SdpAccountView> {
    this.stop();
    return this.invoke({ action: 'disconnect' });
  }
  async readTestTicket(): Promise<SdpAccountView> {
    return this.invoke({ action: 'readTestTicket' });
  }
  async invoke(command: SdpBrokerCommand): Promise<SdpAccountView> {
    return (await this.backend.invoke(command)).view;
  }
  async connect(): Promise<SdpAccountView> {
    await this.disconnect();
    const generation = this.generation;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const deadline = Date.now() + 300_000;
    let consumed = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', SDP_CALLBACK);
      const candidate = url.searchParams.get('state') ?? '';
      if (
        request.method !== 'GET' ||
        url.pathname !== '/callback' ||
        request.headers.host !== '127.0.0.1:8766'
      ) {
        this.reply(response, false);
        return;
      }
      if (
        consumed ||
        Date.now() >= deadline ||
        generation !== this.generation ||
        new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length ||
        Buffer.byteLength(candidate) !== Buffer.byteLength(state) ||
        !timingSafeEqual(Buffer.from(candidate), Buffer.from(state))
      ) {
        this.reply(response, false);
        return;
      }
      consumed = true;
      void this.callback(response, url.searchParams, state, verifier, generation);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxConnections = 8;
    this.listener = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(8766, '127.0.0.1', resolve);
      });
      const result = await this.backend.invoke({
        action: 'begin',
        state,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      if (generation !== this.generation) {
        server.close();
        return this.status();
      }
      if (!result.authorizationUrl) throw new Error('Sign-in unavailable.');
      const authorization = new URL(result.authorizationUrl);
      if (
        authorization.origin !== SDP_ACCOUNTS ||
        authorization.pathname !== '/oauth/v2/auth' ||
        authorization.searchParams.get('state') !== state ||
        authorization.searchParams.get('redirect_uri') !== SDP_CALLBACK
      )
        throw new Error('Invalid sign-in destination.');
      this.timer = setTimeout(() => {
        if (generation === this.generation) void this.disconnect().catch(() => undefined);
      }, 300_000);
      this.timer.unref();
      await this.openBrowser(authorization.toString());
      return result.view;
    } catch {
      if (generation === this.generation) await this.disconnect().catch(() => undefined);
      throw new Error('Could not start SDP sign-in.');
    }
  }
  private async callback(
    response: ServerResponse,
    params: URLSearchParams,
    state: string,
    verifier: string,
    generation: number,
  ): Promise<void> {
    let success = false;
    try {
      const code = params.get('code');
      if (
        !code ||
        code.length > 2048 ||
        params.has('error') ||
        (params.has('location') && params.get('location') !== 'us') ||
        (params.has('accounts-server') && params.get('accounts-server') !== SDP_ACCOUNTS)
      )
        throw new Error('Invalid callback.');
      const result = await this.backend.invoke({ action: 'complete', code, state, verifier });
      success = generation === this.generation && result.view.status === 'connected';
    } catch {
      if (generation === this.generation)
        await this.backend.invoke({ action: 'disconnect' }).catch(() => undefined);
    }
    this.reply(response, success);
    if (generation === this.generation) {
      clearTimeout(this.timer);
      this.listener?.close();
      this.listener = undefined;
    }
  }
  private reply(response: ServerResponse, success: boolean): void {
    response.writeHead(success ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'close',
    });
    response.end(
      `<html lang="en"><title>Relay SDP</title><h1>${success ? 'SDP connected' : 'Sign-in not completed'}</h1><p>Return to Relay to continue. You can close this tab.</p></html>`,
    );
  }
}
