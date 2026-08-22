import {
  compareRelayVersions,
  normalizeRelaySha256Digest,
  normalizeRelayVersionTag,
  relayReleaseAssetNames,
  RELAY_LATEST_RELEASE_API_URL,
  type RelayUpdateCheck,
} from '@shared/releases';

type FetchRequestInit = NonNullable<Parameters<typeof fetch>[1]>;
type NoStoreFetchRequestInit = FetchRequestInit & { cache: 'no-store' };

type ReleaseUpdateServiceOptions = {
  fetch?: typeof globalThis.fetch;
  getCurrentVersion: () => string;
  requestTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RELEASE_RESPONSE_BYTES = 64 * 1_024;
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

async function readBoundedResponseBody(response: Response): Promise<string> {
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
      if (bytes > MAX_RELEASE_RESPONSE_BYTES) {
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
  return {
    version,
    immutable: parsed.immutable === true,
    installable: parseInstallableRelease(parsed, version),
  };
}

export class ReleaseUpdateService {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getCurrentVersion: () => string;
  private readonly requestTimeoutMs: number;
  private inFlight: { currentVersion: string; promise: Promise<RelayUpdateCheck> } | null = null;
  private lastCheckedInstallableVersion: string | null = null;

  constructor(options: ReleaseUpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.getCurrentVersion = options.getCurrentVersion;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
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

  async resolveLatestInstallable(): Promise<RelayInstallableRelease> {
    const currentVersion = this.getCurrentVersion();
    if (compareRelayVersions(currentVersion, currentVersion) === null) {
      throw new Error('Packaged Relay version is not a normal semantic version');
    }

    const expectedVersion = this.lastCheckedInstallableVersion;
    if (!expectedVersion) throw new Error('No installable GitHub release was confirmed');

    const release = await this.fetchRelease(currentVersion);
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

  private async fetchUpdate(currentVersion: string): Promise<RelayUpdateCheck> {
    const release = await this.fetchRelease(currentVersion);
    const updateAvailable = compareRelayVersions(release.version, currentVersion) === 1;
    const installable = updateAvailable ? release.installable : null;
    this.lastCheckedInstallableVersion = installable?.version ?? null;
    return {
      currentVersion,
      latestVersion: release.version,
      updateAvailable,
      installable: Boolean(installable),
      assetSizeBytes: installable?.archive.size ?? null,
    };
  }

  private async fetchRelease(currentVersion: string): Promise<ParsedRelease> {
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
      return await readLatestRelease(response);
    } finally {
      clearTimeout(timeout);
    }
  }
}
