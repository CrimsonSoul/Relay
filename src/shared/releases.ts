const NORMAL_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export const RELAY_LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/CrimsonSoul/Relay/releases/latest';
export const RELAY_RELEASES_URL = 'https://github.com/CrimsonSoul/Relay/releases';

export type RelayUpdateCheck = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
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
