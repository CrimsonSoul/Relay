import { createHash } from 'node:crypto';
import {
  DYNATRACE_OAUTH_SCOPES,
  normalizeDynatraceOAuthCredentials,
} from '@shared/dynatraceProblems';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';

const TOKEN_URL = 'https://sso.dynatrace.com/sso/oauth2/token';
const MAX_RESPONSE_BYTES = 64 * 1024;
const FAILURE_BACKOFF_MS = 30_000;

export function dynatraceAuthenticationKey(config: DynatraceProblemsConfig): string {
  return createHash('sha256')
    .update(JSON.stringify([config.environmentUrl, config.apiToken, config.oauth]))
    .digest('hex');
}

type TokenState = {
  key: string;
  accessToken?: string;
  expiresAt: number;
  pending?: Promise<string>;
  error?: Error;
  retryAt: number;
};

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Dynatrace OAuth returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new Error('Dynatrace OAuth response exceeded its limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function waitForToken(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return pending;
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Only the server exchanges credentials. Access tokens are bounded, short-lived memory state. */
export class DynatraceAuthentication {
  private state: TokenState | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  clear(): void {
    this.state = null;
  }

  async token(config: DynatraceProblemsConfig, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!config.oauth)
      throw new Error(
        'Dynatrace syncing requires OAuth setup. Configure an OAuth client in Relay Administration; existing problems and scope are preserved.',
      );
    const key = dynatraceAuthenticationKey(config);
    if (this.state?.key !== key) this.state = { key, expiresAt: 0, retryAt: 0 };
    const state = this.state;
    if (state.accessToken && Date.now() < state.expiresAt) return state.accessToken;
    if (state.error && Date.now() < state.retryAt) throw state.error;
    state.pending ??= this.exchange(config)
      .then(({ accessToken, expiresAt }) => {
        state.accessToken = accessToken;
        state.expiresAt = expiresAt;
        state.error = undefined;
        return accessToken;
      })
      .catch((error: unknown) => {
        // Never attach a network error, response body, or credentials to diagnostics.
        const safeError =
          error instanceof OAuthRequestError
            ? new Error(error.message)
            : new Error(
                'Dynatrace OAuth token request failed. Check network access to sso.dynatrace.com and the client configuration.',
              );
        state.error = safeError;
        state.retryAt = Date.now() + FAILURE_BACKOFF_MS;
        state.accessToken = undefined;
        throw safeError;
      })
      .finally(() => {
        state.pending = undefined;
      });
    return waitForToken(state.pending, signal);
  }

  private async exchange(
    config: DynatraceProblemsConfig,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const oauth = normalizeDynatraceOAuthCredentials(config.oauth);
    if (!oauth) throw new OAuthRequestError('Dynatrace OAuth client configuration is invalid.');
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(8_000);
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        resource: `urn:dtaccount:${oauth.accountUuid}`,
        scope: DYNATRACE_OAUTH_SCOPES.join(' '),
      }).toString(),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new OAuthRequestError(
        `Dynatrace OAuth token request failed (HTTP ${response.status}). Check the client ID, secret, account UUID, and the listed OAuth scopes.`,
      );
    }
    const value = await boundedJson(response, signal);
    if (!value || typeof value !== 'object')
      throw new OAuthRequestError('Dynatrace OAuth returned an invalid token response.');
    const {
      access_token: accessToken,
      token_type: tokenType,
      expires_in: expiresIn,
    } = value as Record<string, unknown>;
    if (
      typeof accessToken !== 'string' ||
      !accessToken ||
      accessToken.length > 32_768 ||
      /\s/.test(accessToken) ||
      typeof tokenType !== 'string' ||
      tokenType.toLowerCase() !== 'bearer' ||
      typeof expiresIn !== 'number' ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > 86_400
    ) {
      throw new OAuthRequestError('Dynatrace OAuth returned an invalid token response.');
    }
    const expiresAt = startedAt + expiresIn * 1000 - Math.min(30_000, expiresIn * 100);
    if (expiresAt <= Date.now())
      throw new OAuthRequestError('Dynatrace OAuth returned an expired access token.');
    return { accessToken, expiresAt };
  }
}

class OAuthRequestError extends Error {}

const authenticationByFetch = new WeakMap<typeof fetch, DynatraceAuthentication>();

export function dynatraceAuthentication(fetchImpl: typeof fetch): DynatraceAuthentication {
  let authentication = authenticationByFetch.get(fetchImpl);
  if (!authentication) {
    authentication = new DynatraceAuthentication(fetchImpl);
    authenticationByFetch.set(fetchImpl, authentication);
  }
  return authentication;
}
