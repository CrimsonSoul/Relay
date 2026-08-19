const NORMAL_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const GITHUB_SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/u;

export const RELAY_LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/CrimsonSoul/Relay/releases/latest';
export const RELAY_RELEASES_URL = 'https://github.com/CrimsonSoul/Relay/releases';

export type RelayUpdateCheck = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installable: boolean;
  assetSizeBytes: number | null;
};

export type RelayUpdatePhase =
  'idle' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'ready-to-restart' | 'error';

export type RelayUpdateFailureCode =
  | 'unsupported'
  | 'release-not-immutable'
  | 'release-changed'
  | 'download-failed'
  | 'verification-failed'
  | 'cancelled'
  | 'install-failed'
  | 'restart-unavailable';

export type RelayUpdateSnapshot = {
  phase: RelayUpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  installable: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  failureCode: RelayUpdateFailureCode | null;
};

export type RelayReleaseAssetNames = {
  archive: string;
  checksum: string;
};

type NormalVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseNormalVersion(value: string): NormalVersion | null {
  const match = NORMAL_VERSION_PATTERN.exec(value);
  if (!match) return null;

  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(version).every(Number.isSafeInteger) ? version : null;
}

export function normalizeRelayVersionTag(tag: string): string | null {
  if (!tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return parseNormalVersion(version) ? version : null;
}

export function relayReleaseAssetNames(version: string): RelayReleaseAssetNames | null {
  if (!parseNormalVersion(version)) return null;
  const archive = `Relay-v${version}-windows-x64.zip`;
  return { archive, checksum: `${archive}.sha256` };
}

export function normalizeRelaySha256Digest(value: string): string | null {
  return GITHUB_SHA256_DIGEST_PATTERN.exec(value)?.[1] ?? null;
}

export function compareRelayVersions(left: string, right: string): -1 | 0 | 1 | null {
  const leftVersion = parseNormalVersion(left);
  const rightVersion = parseNormalVersion(right);
  if (!leftVersion || !rightVersion) return null;

  const difference =
    leftVersion.major - rightVersion.major ||
    leftVersion.minor - rightVersion.minor ||
    leftVersion.patch - rightVersion.patch;
  if (difference === 0) return 0;
  return difference > 0 ? 1 : -1;
}
