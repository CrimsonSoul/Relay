const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LAUNCHER_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}\.exe$/i;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
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
  let buildId;
  if (env.RELAY_BUILD_ID) {
    buildId = validateBuildId(env.RELAY_BUILD_ID);
  } else {
    if (typeof gitSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(gitSha)) {
      throw new Error('Missing or invalid Git build identity for the Windows package');
    }
    buildId = `r1-${gitSha.slice(0, 16).toLowerCase()}`;
  }

  const suffix = dirty ? `-dirty-${nonce ?? Date.now().toString(36)}` : '';
  return validateBuildId(`${buildId}${suffix}`);
}

function validateHarnessRoot(value) {
  const segments = typeof value === 'string' ? value.slice(3).split('\\') : [];
  const containsControlCharacter =
    typeof value === 'string' &&
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || code === 127);
    });
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !/^[A-Za-z]:\\/.test(value) ||
    segments.length < 2 ||
    containsControlCharacter ||
    /[<>:"/|?*$!]/.test(value.slice(2)) ||
    value.endsWith('\\') ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || /[ .]$/.test(segment),
    )
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
  const validatedRoot = validateHarnessRoot(root);
  const parent = validatedRoot.slice(0, validatedRoot.lastIndexOf('\\'));
  return {
    root: validatedRoot,
    dataRoot: validateHarnessRoot(`${parent}\\AppData\\Relay`),
  };
}

export function renderBuildDefines({
  buildId,
  launcherFile,
  version,
  targetCommitish,
  packagedAt,
  harnessRoot,
}) {
  const safeBuildId = validateBuildId(buildId);
  if (typeof launcherFile !== 'string' || !LAUNCHER_FILE_PATTERN.test(launcherFile)) {
    throw new Error('Windows launcher filename must be a path-free .exe filename');
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error('Windows package version must be a canonical normal semantic version');
  }
  if (typeof targetCommitish !== 'string' || !COMMIT_PATTERN.test(targetCommitish)) {
    throw new Error('Windows package target commit must be a full lowercase Git SHA');
  }
  if (
    typeof packagedAt !== 'string' ||
    !Number.isFinite(Date.parse(packagedAt)) ||
    new Date(packagedAt).toISOString() !== packagedAt
  ) {
    throw new Error('Windows package timestamp must be a canonical ISO timestamp');
  }

  const defines = [
    `!define RELAY_BUILD_ID "${safeBuildId}"`,
    `!define RELAY_LAUNCHER_FILE "${launcherFile}"`,
    `!define RELAY_BUILD_VERSION "${version}"`,
    `!define RELAY_TARGET_COMMITISH "${targetCommitish}"`,
    `!define RELAY_PACKAGED_AT "${packagedAt}"`,
    '!define RELAY_RECOVERY_PROTOCOL "2"',
    '!define RELAY_SERVER_DATA_EPOCH "1"',
    '!define RELAY_CLIENT_DATA_EPOCH "1"',
  ];
  if (harnessRoot) {
    defines.push(
      '!define RELAY_BOOTSTRAP_HARNESS',
      `!define RELAY_BOOTSTRAP_HARNESS_ROOT "${validateHarnessRoot(harnessRoot)}"`,
    );
  }
  return [...defines, ''].join('\n');
}
