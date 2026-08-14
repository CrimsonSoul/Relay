import {
  compareRelayVersions,
  normalizeRelayVersionTag,
  RELAY_LATEST_RELEASE_API_URL,
  type RelayUpdateCheck,
} from '@shared/releases';

type FetchRequestInit = NonNullable<Parameters<typeof fetch>[1]>;
type NoStoreFetchRequestInit = FetchRequestInit & { cache: 'no-store' };

type ReleaseUpdateServiceOptions = {
  fetch?: typeof globalThis.fetch;
  getCurrentVersion: () => string;
  now?: () => number;
  cacheTtlMs?: number;
  requestTimeoutMs?: number;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RELEASE_RESPONSE_BYTES = 64 * 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readLatestVersion(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  if (response.status !== 200) {
    throw new Error(`GitHub release request returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new Error('GitHub release response was not JSON');
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error('GitHub release response exceeded the size limit');
  }

  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error('GitHub release response exceeded the size limit');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('GitHub release response contained malformed JSON');
  }
  if (!isRecord(parsed) || parsed.draft !== false || parsed.prerelease !== false) {
    throw new Error('GitHub release response was not a published normal release');
  }

  const latestVersion =
    typeof parsed.tag_name === 'string' ? normalizeRelayVersionTag(parsed.tag_name) : null;
  if (!latestVersion) throw new Error('GitHub release response contained an invalid version tag');
  return latestVersion;
}

export class ReleaseUpdateService {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getCurrentVersion: () => string;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly requestTimeoutMs: number;
  private cached: { currentVersion: string; expiresAt: number; value: RelayUpdateCheck } | null =
    null;
  private inFlight: { currentVersion: string; promise: Promise<RelayUpdateCheck> } | null = null;

  constructor(options: ReleaseUpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.getCurrentVersion = options.getCurrentVersion;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  check(): Promise<RelayUpdateCheck> {
    const currentVersion = this.getCurrentVersion();
    if (compareRelayVersions(currentVersion, currentVersion) === null) {
      return Promise.reject(new Error('Packaged Relay version is not a normal semantic version'));
    }

    const now = this.now();
    if (this.cached?.currentVersion === currentVersion && this.cached.expiresAt > now) {
      return Promise.resolve(this.cached.value);
    }
    if (this.inFlight?.currentVersion === currentVersion) return this.inFlight.promise;

    const promise = this.fetchUpdate(currentVersion).then((value) => {
      this.cached = {
        currentVersion,
        expiresAt: this.now() + this.cacheTtlMs,
        value,
      };
      return value;
    });
    this.inFlight = { currentVersion, promise };
    const clearInFlight = () => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    };
    void promise.then(clearInFlight, clearInFlight);
    return promise;
  }

  private async fetchUpdate(currentVersion: string): Promise<RelayUpdateCheck> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const request: NoStoreFetchRequestInit = {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `Relay/${currentVersion}`,
      },
    };

    try {
      const response = await this.fetchImpl(RELAY_LATEST_RELEASE_API_URL, request);
      const latestVersion = await readLatestVersion(response);
      return {
        currentVersion,
        latestVersion,
        updateAvailable: compareRelayVersions(latestVersion, currentVersion) === 1,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
