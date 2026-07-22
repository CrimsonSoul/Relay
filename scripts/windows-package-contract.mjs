const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LAUNCHER_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}\.exe$/i;
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function validateBuildId(value) {
  const baseName = typeof value === 'string' ? value.split('.', 1)[0] : '';
  if (
    typeof value !== 'string' ||
    !BUILD_ID_PATTERN.test(value) ||
    value.endsWith('.') ||
    RESERVED_WINDOWS_NAMES.has(baseName)
  ) {
    throw new Error('Windows package build ID must be a canonical lowercase path-safe identity');
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

function validateHarnessRoot(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z]:\\[^<>:"/|?*$\r\n]+/.test(value) ||
    value.endsWith('\\') ||
    value
      .slice(3)
      .split('\\')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Windows bootstrap harness root must be a fixed absolute path');
  }
  return value;
}

export function resolveHarnessConfig(env = {}) {
  const enabled = env.RELAY_BOOTSTRAP_HARNESS;
  const root = env.RELAY_BOOTSTRAP_HARNESS_ROOT;
  if (enabled === undefined && root === undefined) return null;
  if (enabled !== '1' || !root) {
    throw new Error('Windows bootstrap harness variables require RELAY_BOOTSTRAP_HARNESS=1');
  }
  return { root: validateHarnessRoot(root) };
}

export function renderBuildDefines({ buildId, launcherFile, harnessRoot }) {
  const safeBuildId = validateBuildId(buildId);
  if (typeof launcherFile !== 'string' || !LAUNCHER_FILE_PATTERN.test(launcherFile)) {
    throw new Error('Windows launcher filename must be a path-free .exe filename');
  }

  const defines = [
    `!define RELAY_BUILD_ID "${safeBuildId}"`,
    `!define RELAY_LAUNCHER_FILE "${launcherFile}"`,
  ];
  if (harnessRoot) {
    defines.push('!define RELAY_BOOTSTRAP_HARNESS');
    defines.push(`!define RELAY_BOOTSTRAP_HARNESS_ROOT "${validateHarnessRoot(harnessRoot)}"`);
  }
  return [...defines, ''].join('\n');
}
