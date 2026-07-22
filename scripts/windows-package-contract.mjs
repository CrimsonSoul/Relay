const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LAUNCHER_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}\.exe$/i;

export function validateBuildId(value) {
  if (typeof value !== 'string' || !BUILD_ID_PATTERN.test(value)) {
    throw new Error('Windows package build ID must be 1-64 path-safe ASCII characters');
  }
  return value;
}

export function resolveBuildId({ env = {}, gitSha, dirty = false, nonce } = {}) {
  if (env.RELAY_BUILD_ID) return validateBuildId(env.RELAY_BUILD_ID);
  if (typeof gitSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(gitSha)) {
    throw new Error('Missing or invalid Git build identity for the Windows package');
  }

  const suffix = dirty ? `-dirty-${nonce ?? Date.now().toString(36)}` : '';
  return validateBuildId(`r1-${gitSha.slice(0, 16).toLowerCase()}${suffix}`);
}

export function renderBuildDefines({ buildId, launcherFile }) {
  const safeBuildId = validateBuildId(buildId);
  if (typeof launcherFile !== 'string' || !LAUNCHER_FILE_PATTERN.test(launcherFile)) {
    throw new Error('Windows launcher filename must be a path-free .exe filename');
  }

  return [
    `!define RELAY_BUILD_ID "${safeBuildId}"`,
    `!define RELAY_LAUNCHER_FILE "${launcherFile}"`,
    '',
  ].join('\n');
}

