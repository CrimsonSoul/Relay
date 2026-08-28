import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  compareRelayVersions,
  normalizeRelaySha256Digest,
  normalizeRelayVersionTag,
  relayReleaseByTagApiUrl,
  relayReleaseAssetNames,
  RELAY_LATEST_RELEASE_API_URL,
  RELAY_RELEASE_HISTORY_API_URL,
  type RelayReleaseNotes,
  type RelayUpdateCheck,
} from '@shared/releases';

type FetchRequestInit = NonNullable<Parameters<typeof fetch>[1]>;
type NoStoreFetchRequestInit = FetchRequestInit & { cache: 'no-store' };

type ReleaseUpdateServiceOptions = {
  fetch?: typeof globalThis.fetch;
  getCurrentVersion: () => string;
  requestTimeoutMs?: number;
  cacheFilePath?: string;
};

type FetchDeadlineOptions = Readonly<{
  etag?: string | null;
  signal?: AbortSignal;
}>;

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RELEASE_RESPONSE_BYTES = 64 * 1_024;
const MAX_RELEASE_HISTORY_RESPONSE_BYTES = 512 * 1_024;
const MAX_RELEASE_NOTES = 10;
const MAX_RELEASE_TITLE_CHARACTERS = 200;
const MAX_RELEASE_BODY_BYTES = 64 * 1_024;
const RELEASE_NOTES_CACHE_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 512 * 1_024 * 1_024;
const MAX_CHECKSUM_BYTES = 256;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const RELEASE_ASSET_API_PREFIX = 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/';

export type RelayInstallableAsset = {
  id: number;
  name: string;
  apiUrl: string;
  size: number;
  sha256: string;
};

export type RelayInstallableRelease = {
  version: string;
  targetCommitish: string;
  archive: RelayInstallableAsset;
  checksum: RelayInstallableAsset;
};

type ParsedRelease = {
  version: string;
  immutable: boolean;
  installable: RelayInstallableRelease | null;
  releaseNotes: RelayReleaseNotes | null;
};

type StoredReleaseNotes = {
  schemaVersion: typeof RELEASE_NOTES_CACHE_SCHEMA_VERSION;
  releases: RelayReleaseNotes[];
  etag: string | null;
};

type ReleaseNotesCacheState = {
  releases: RelayReleaseNotes[];
  etag: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReleaseNotes(parsed: Record<string, unknown>): RelayReleaseNotes | null {
  const version =
    typeof parsed.tag_name === 'string' ? normalizeRelayVersionTag(parsed.tag_name) : null;
  if (
    !version ||
    typeof parsed.name !== 'string' ||
    parsed.name.trim().length === 0 ||
    parsed.name.trim().length > MAX_RELEASE_TITLE_CHARACTERS ||
    typeof parsed.body !== 'string' ||
    Buffer.byteLength(parsed.body, 'utf8') > MAX_RELEASE_BODY_BYTES ||
    typeof parsed.published_at !== 'string' ||
    !Number.isFinite(Date.parse(parsed.published_at))
  ) {
    return null;
  }
  return {
    version,
    title: parsed.name.trim(),
    body: parsed.body,
    publishedAt: parsed.published_at,
    immutable: parsed.immutable === true,
  };
}

function parseCachedReleaseNotes(value: unknown): ReleaseNotesCacheState {
  const empty: ReleaseNotesCacheState = { releases: [], etag: null };
  if (!isRecord(value) || value.schemaVersion !== RELEASE_NOTES_CACHE_SCHEMA_VERSION) return empty;
  if (!Array.isArray(value.releases)) return empty;

  const releases: RelayReleaseNotes[] = [];
  for (const item of value.releases.slice(0, MAX_RELEASE_NOTES)) {
    if (!isRecord(item)) continue;
    const parsed = parseReleaseNotes({
      tag_name: typeof item.version === 'string' ? `v${item.version}` : null,
      name: item.title,
      body: item.body,
      published_at: item.publishedAt,
      immutable: item.immutable,
    });
    if (parsed) releases.push(parsed);
  }
  const etag =
    typeof value.etag === 'string' && value.etag.length <= 256 && !/[\r\n]/u.test(value.etag)
      ? value.etag
      : null;
  return { releases, etag };
}

class ReleaseNotesCache {
  private memory: ReleaseNotesCacheState = { releases: [], etag: null };

  constructor(private readonly filePath?: string) {}

  async read(): Promise<RelayReleaseNotes[]> {
    return (await this.readState()).releases;
  }

  async readState(): Promise<ReleaseNotesCacheState> {
    if (!this.filePath) return this.memory;
    try {
      const fileStats = await stat(this.filePath);
      if (!fileStats.isFile() || fileStats.size > MAX_RELEASE_HISTORY_RESPONSE_BYTES) {
        return { releases: [], etag: null };
      }
      return parseCachedReleaseNotes(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return { releases: [], etag: null };
    }
  }

  async write(
    releases: RelayReleaseNotes[],
    etag: string | null = null,
  ): Promise<RelayReleaseNotes[]> {
    const next: RelayReleaseNotes[] = [];
    let contents = '';
    for (const release of releases.slice(0, MAX_RELEASE_NOTES)) {
      const candidate: StoredReleaseNotes = {
        schemaVersion: RELEASE_NOTES_CACHE_SCHEMA_VERSION,
        releases: [...next, release],
        etag,
      };
      const serialized = JSON.stringify(candidate);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RELEASE_HISTORY_RESPONSE_BYTES) continue;
      next.push(release);
      contents = serialized;
    }
    const stored: StoredReleaseNotes = {
      schemaVersion: RELEASE_NOTES_CACHE_SCHEMA_VERSION,
      releases: next,
      etag,
    };
    contents ||= JSON.stringify(stored);
    this.memory = { releases: next, etag };
    if (!this.filePath) return next;

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, contents, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
      return next;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async merge(release: RelayReleaseNotes): Promise<void> {
    const state = await this.readState();
    const matching = state.releases.find((item) => item.version === release.version);
    const selected = matching?.immutable ? matching : release;
    const merged = [selected, ...state.releases.filter((item) => item.version !== release.version)];
    merged.sort((left, right) => compareRelayVersions(right.version, left.version) ?? 0);
    await this.write(merged, state.etag);
  }

  async mergeHistory(
    releases: RelayReleaseNotes[],
    etag: string | null,
  ): Promise<RelayReleaseNotes[]> {
    const state = await this.readState();
    const refreshedVersions = new Set(releases.map((release) => release.version));
    const merged = releases.map((release) => {
      const cached = state.releases.find((item) => item.version === release.version);
      return cached?.immutable ? cached : release;
    });
    merged.push(...state.releases.filter((release) => !refreshedVersions.has(release.version)));
    merged.sort((left, right) => compareRelayVersions(right.version, left.version) ?? 0);
    const next = merged.slice(0, MAX_RELEASE_NOTES);
    return this.write(next, etag);
  }
}

function parseInstallableAsset(
  value: unknown,
  expectedName: string,
  maximumBytes: number,
): RelayInstallableAsset | null {
  if (!isRecord(value) || value.name !== expectedName || value.state !== 'uploaded') return null;
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) return null;
  if (
    !Number.isSafeInteger(value.size) ||
    Number(value.size) <= 0 ||
    Number(value.size) > maximumBytes
  ) {
    return null;
  }

  const id = Number(value.id);
  const expectedApiUrl = `${RELEASE_ASSET_API_PREFIX}${id}`;
  if (value.url !== expectedApiUrl) return null;
  if (!POSITIVE_INTEGER_PATTERN.test(String(id))) return null;

  const sha256 = typeof value.digest === 'string' ? normalizeRelaySha256Digest(value.digest) : null;
  if (!sha256) return null;

  return {
    id,
    name: expectedName,
    apiUrl: expectedApiUrl,
    size: Number(value.size),
    sha256,
  };
}

function parseInstallableRelease(
  parsed: Record<string, unknown>,
  version: string,
): RelayInstallableRelease | null {
  if (parsed.immutable !== true) return null;
  if (
    typeof parsed.target_commitish !== 'string' ||
    !COMMIT_SHA_PATTERN.test(parsed.target_commitish)
  ) {
    return null;
  }
  if (!Array.isArray(parsed.assets) || parsed.assets.length !== 2) return null;

  const names = relayReleaseAssetNames(version);
  if (!names) return null;
  const archiveCandidates = parsed.assets.filter(
    (asset) => isRecord(asset) && asset.name === names.archive,
  );
  const checksumCandidates = parsed.assets.filter(
    (asset) => isRecord(asset) && asset.name === names.checksum,
  );
  if (archiveCandidates.length !== 1 || checksumCandidates.length !== 1) return null;

  const archive = parseInstallableAsset(archiveCandidates[0], names.archive, MAX_ARCHIVE_BYTES);
  const checksum = parseInstallableAsset(checksumCandidates[0], names.checksum, MAX_CHECKSUM_BYTES);
  if (!archive || !checksum) return null;

  return {
    version,
    targetCommitish: parsed.target_commitish,
    archive,
    checksum,
  };
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes = MAX_RELEASE_RESPONSE_BYTES,
): Promise<string> {
  if (!response.body) throw new Error('GitHub release response did not contain a body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value || result.value.byteLength === 0) continue;
      bytes += result.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub release response exceeded the size limit');
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

async function readLatestRelease(
  response: Awaited<ReturnType<typeof fetch>>,
): Promise<ParsedRelease> {
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

  const body = await readBoundedResponseBody(response);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('GitHub release response contained malformed JSON');
  }
  if (!isRecord(parsed) || parsed.draft !== false || parsed.prerelease !== false) {
    throw new Error('GitHub release response was not a published normal release');
  }

  const version =
    typeof parsed.tag_name === 'string' ? normalizeRelayVersionTag(parsed.tag_name) : null;
  if (!version) throw new Error('GitHub release response contained an invalid version tag');
  const releaseNotes = parseReleaseNotes(parsed);
  return {
    version,
    immutable: parsed.immutable === true,
    installable: parseInstallableRelease(parsed, version),
    releaseNotes,
  };
}

async function readReleaseHistory(
  response: Awaited<ReturnType<typeof fetch>>,
): Promise<RelayReleaseNotes[]> {
  if (response.status !== 200) {
    throw new Error(`GitHub release history request returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new Error('GitHub release history response was not JSON');
  }
  const body = await readBoundedResponseBody(response, MAX_RELEASE_HISTORY_RESPONSE_BYTES);
  const parsed = JSON.parse(body) as unknown;
  if (!Array.isArray(parsed)) throw new Error('GitHub release history response was not a list');

  return parsed
    .filter((value) => isRecord(value) && value.draft === false && value.prerelease === false)
    .map((value) => parseReleaseNotes(value as Record<string, unknown>))
    .filter((value): value is RelayReleaseNotes => value !== null)
    .slice(0, MAX_RELEASE_NOTES);
}

export class ReleaseUpdateService {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getCurrentVersion: () => string;
  private readonly requestTimeoutMs: number;
  private readonly releaseNotesCache: ReleaseNotesCache;
  private inFlight: { currentVersion: string; promise: Promise<RelayUpdateCheck> } | null = null;
  private lastCheckedInstallableVersion: string | null = null;

  constructor(options: ReleaseUpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.getCurrentVersion = options.getCurrentVersion;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.releaseNotesCache = new ReleaseNotesCache(options.cacheFilePath);
  }

  getCachedReleaseNotes(): Promise<RelayReleaseNotes[]> {
    return this.releaseNotesCache.read();
  }

  async refreshReleaseNotes(): Promise<RelayReleaseNotes[]> {
    const currentVersion = this.getCurrentVersion();
    const cached = await this.releaseNotesCache.readState();
    const fetched = await this.fetchWithDeadline(
      RELAY_RELEASE_HISTORY_API_URL,
      currentVersion,
      async (response) => {
        if (response.status === 304) return null;
        const releases = await readReleaseHistory(response);
        const responseEtag = response.headers.get('etag');
        return {
          releases,
          etag:
            responseEtag && responseEtag.length <= 256 && !/[\r\n]/u.test(responseEtag)
              ? responseEtag
              : null,
        };
      },
      { etag: cached.etag },
    );
    return fetched
      ? this.releaseNotesCache.mergeHistory(fetched.releases, fetched.etag)
      : cached.releases;
  }

  check(): Promise<RelayUpdateCheck> {
    const currentVersion = this.getCurrentVersion();
    if (compareRelayVersions(currentVersion, currentVersion) === null) {
      return Promise.reject(new Error('Packaged Relay version is not a normal semantic version'));
    }

    if (this.inFlight?.currentVersion === currentVersion) return this.inFlight.promise;

    const promise = this.fetchUpdate(currentVersion);
    this.inFlight = { currentVersion, promise };
    const clearInFlight = () => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    };
    void promise.then(clearInFlight, clearInFlight);
    return promise;
  }

  async resolveLatestInstallable(signal?: AbortSignal): Promise<RelayInstallableRelease> {
    const currentVersion = this.getCurrentVersion();
    if (compareRelayVersions(currentVersion, currentVersion) === null) {
      throw new Error('Packaged Relay version is not a normal semantic version');
    }

    const expectedVersion = this.lastCheckedInstallableVersion;
    if (!expectedVersion) throw new Error('No installable GitHub release was confirmed');

    const release = await this.fetchWithDeadline(
      RELAY_LATEST_RELEASE_API_URL,
      currentVersion,
      readLatestRelease,
      { signal },
    );
    if (compareRelayVersions(release.version, currentVersion) !== 1) {
      throw new Error('GitHub latest release is not newer than installed Relay');
    }
    if (!release.immutable) throw new Error('GitHub latest release is not immutable');
    if (!release.installable) throw new Error('GitHub latest release assets are not installable');
    if (release.version !== expectedVersion) {
      throw new Error('GitHub latest release changed after update discovery');
    }
    return release.installable;
  }

  async resolveInstallableByTag(
    version: string,
    expectedTargetCommitish: string,
  ): Promise<RelayInstallableRelease> {
    const url = relayReleaseByTagApiUrl(version);
    if (!url) throw new Error('Recovery release version was invalid');
    if (!COMMIT_SHA_PATTERN.test(expectedTargetCommitish)) {
      throw new Error('Recovery release commit was invalid');
    }

    const release = await this.fetchWithDeadline(url, this.getCurrentVersion(), readLatestRelease);
    if (release.version !== version) throw new Error('Recovery release tag changed');
    if (!release.immutable) throw new Error('Recovery release is not immutable');
    if (!release.installable) throw new Error('Recovery release assets are not installable');
    if (release.installable.targetCommitish !== expectedTargetCommitish) {
      throw new Error('Recovery release commit changed');
    }
    return release.installable;
  }

  private async fetchUpdate(currentVersion: string): Promise<RelayUpdateCheck> {
    const release = await this.fetchWithDeadline(
      RELAY_LATEST_RELEASE_API_URL,
      currentVersion,
      readLatestRelease,
    );
    if (release.releaseNotes) {
      await this.releaseNotesCache.merge(release.releaseNotes).catch(() => undefined);
    }
    const updateAvailable = compareRelayVersions(release.version, currentVersion) === 1;
    const installable = updateAvailable ? release.installable : null;
    this.lastCheckedInstallableVersion = installable?.version ?? null;
    return {
      currentVersion,
      latestVersion: release.version,
      targetCommitish: installable?.targetCommitish ?? null,
      updateAvailable,
      installable: Boolean(installable),
      assetSizeBytes: installable?.archive.size ?? null,
      releaseNotes: release.releaseNotes,
    };
  }

  private async fetchWithDeadline<T>(
    url: string,
    currentVersion: string,
    consume: (response: Response) => Promise<T>,
    options: FetchDeadlineOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) relayAbort();
    else options.signal?.addEventListener('abort', relayAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error('GitHub release request timed out')),
      this.requestTimeoutMs,
    );
    const request: NoStoreFetchRequestInit = {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `Relay/${currentVersion}`,
        ...(options.etag ? { 'If-None-Match': options.etag } : {}),
      },
    };

    try {
      return await consume(await this.fetchImpl(url, request));
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', relayAbort);
    }
  }
}
