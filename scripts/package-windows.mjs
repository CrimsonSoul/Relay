import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  renderBuildDefines,
  resolveBuildId,
  resolveHarnessConfig,
} from './windows-package-contract.mjs';

const require = createRequire(import.meta.url);
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const generatedDir = join(projectDir, 'release', 'windows-bootstrap');
const launcherFile = 'RelayLauncher.exe';
const launcherPath = join(generatedDir, launcherFile);
const buildDefinesPath = join(generatedDir, 'relay-build.nsh');
const buildIdentityPath = join(generatedDir, 'relay-build-id.txt');
const fixtureAppDir = join(generatedDir, 'relay-fixture-app');
const fixtureExecutablePath = join(fixtureAppDir, 'Relay.exe');
const fixtureIdentityPath = join(fixtureAppDir, 'resources', 'relay-build-id.txt');
const recoveryTimingPath = join(projectDir, 'build', 'windows', 'recovery-timing.json');
const packageJson = require(join(projectDir, 'package.json'));

export const FIXTURE_RUNTIME_INTEGRITY_FILES = [
  ['d3dcompiler_47.dll', 'relay fixture d3d compiler'],
  ['dxcompiler.dll', 'relay fixture dx compiler'],
  ['dxil.dll', 'relay fixture dxil'],
  ['ffmpeg.dll', 'relay fixture ffmpeg'],
  ['libEGL.dll', 'relay fixture libEGL'],
  ['libGLESv2.dll', 'relay fixture libGLESv2'],
  ['vk_swiftshader.dll', 'relay fixture vk swiftshader'],
  ['vulkan-1.dll', 'relay fixture vulkan'],
  ['resources/app.asar', 'relay fixture app archive'],
  ['resources/pocketbase/win32-x64/pocketbase.exe', 'relay fixture pocketbase'],
  [
    'resources/pocketbase/hooks/relay_privileged_reauth.pb.js',
    '// relay fixture privileged reauthentication hook\n',
  ],
  [
    'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'relay fixture better-sqlite3',
  ],
  [
    'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
    'relay fixture koffi',
  ],
];

function printUsage() {
  console.log(`Usage: node scripts/package-windows.mjs [electron-builder options]

Options:
  --compile-launcher-only  Compile the stable launcher without packaging Relay
  --fixture                Package a lightweight CI runtime fixture
  --help                   Show this help

RELAY_BUILD_ID may provide a path-safe CI build identity. Other options are
forwarded to electron-builder.`);
}

function readGitState() {
  // Git is a required developer/CI tool here, not an application subprocess or user-selected command.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const gitSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: projectDir,
    encoding: 'utf8',
  }).trim();
  const dirty =
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: projectDir,
      encoding: 'utf8',
    }).trim().length > 0;
  return { gitSha, dirty };
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectDir,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const outcome = signal ? `with signal ${signal}` : `with exit code ${code}`;
      reject(new Error(`${command} failed ${outcome}`));
    });
  });
}

export function resolveMakensisCommand(
  makensis,
  { platform = process.platform, dirname: dirnamePath = dirname, join: joinPath = join } = {},
) {
  if (platform !== 'win32' || !makensis.path.toLowerCase().endsWith('.cmd')) return makensis;

  const nsisDir = joinPath(dirnamePath(makensis.path), 'windows');
  return {
    ...makensis,
    path: joinPath(nsisDir, 'makensis.exe'),
    env: { ...makensis.env, NSISDIR: nsisDir },
  };
}

export function resolveElectronBuilderArgs(args, env = process.env) {
  const forwarded = args.filter((arg) => arg !== '--compile-launcher-only' && arg !== '--fixture');
  const hasPublishPolicy = forwarded.some(
    (arg) => arg === '--publish' || arg.startsWith('--publish='),
  );
  const releaseVersion = env.RELAY_RELEASE_VERSION === '' ? undefined : env.RELAY_RELEASE_VERSION;
  const hasVersionOverride = forwarded.some((arg) =>
    arg.startsWith('--config.extraMetadata.version'),
  );
  if (releaseVersion !== undefined) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(releaseVersion)) {
      throw new Error('Relay release version must be a canonical normal semantic version');
    }
    if (hasVersionOverride) {
      throw new Error('Relay release version cannot be combined with a package version override');
    }
  }

  const withPublishPolicy = hasPublishPolicy ? forwarded : [...forwarded, '--publish', 'never'];
  return releaseVersion
    ? [...withPublishPolicy, `--config.extraMetadata.version=${releaseVersion}`]
    : withPublishPolicy;
}

export function resolvePackageMode(args) {
  const compileOnly = args.includes('--compile-launcher-only');
  const fixture = args.includes('--fixture');
  if (compileOnly && fixture) {
    throw new Error('--fixture and --compile-launcher-only cannot be combined');
  }
  return { compileOnly, fixture };
}

export function resolveWindowsNativeDependencyInstall(koffiVersion, platform = process.platform) {
  if (!/^\d+\.\d+\.\d+$/u.test(koffiVersion)) {
    throw new Error('Koffi version must be an exact semantic version');
  }

  const args = ['install', '--no-save', '--ignore-scripts'];
  if (platform !== 'win32') args.push('--force');
  args.push(`@koromix/koffi-win32-x64@${koffiVersion}`);
  return args;
}

export function resolveHostNativeDependencyRestore() {
  return ['rebuild', 'better-sqlite3', '--build-from-source'];
}

export function resolveNpmInvocation({
  nodePath = process.execPath,
  npmExecPath,
  platform = process.platform,
} = {}) {
  if (npmExecPath) return { argsPrefix: [npmExecPath], command: nodePath };
  if (platform === 'win32') {
    return {
      argsPrefix: [win32.join(win32.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
      command: nodePath,
    };
  }
  return { argsPrefix: [], command: 'npm' };
}

async function runNpm(args) {
  const { argsPrefix, command } = resolveNpmInvocation({
    npmExecPath: process.env.npm_execpath,
  });
  await run(command, [...argsPrefix, ...args]);
}

async function stageWindowsNativeDependencies() {
  const koffiVersion = packageJson.dependencies?.koffi;
  await runNpm(resolveWindowsNativeDependencyInstall(koffiVersion));
}

async function restoreHostNativeDependencies() {
  console.log('Restoring better-sqlite3 for the current Node ABI...');
  await runNpm(resolveHostNativeDependencyRestore());
}

async function compileLauncher(harness) {
  await mkdir(generatedDir, { recursive: true });
  const recoveryTiming = JSON.parse(await readFile(recoveryTimingPath, 'utf8'));
  const requiredTimingValues = [
    recoveryTiming.startupDeadlineMs,
    recoveryTiming.probationDurationMs,
    recoveryTiming.shutdownOverheadMs,
    recoveryTiming.supervisorTimeoutMs,
  ];
  if (
    requiredTimingValues.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    recoveryTiming.supervisorTimeoutMs <
      recoveryTiming.startupDeadlineMs +
        recoveryTiming.probationDurationMs +
        recoveryTiming.shutdownOverheadMs
  ) {
    throw new Error('Windows recovery timing contract was invalid');
  }
  const makensis = resolveMakensisCommand(await getMakeNsisPath('1.2.1'));
  const defines = [
    '-WX',
    '-INPUTCHARSET',
    'UTF8',
    `-X!addincludedir "${join(projectDir, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include')}"`,
    `-DRELAY_LAUNCHER_OUT=${launcherPath}`,
    `-DRELAY_LAUNCHER_ICON=${join(projectDir, 'build', 'icon.ico')}`,
    `-DRELAY_PROBATION_DURATION_MS=${recoveryTiming.probationDurationMs}`,
    `-DRELAY_PROBATION_SUPERVISOR_TIMEOUT_MS=${recoveryTiming.supervisorTimeoutMs}`,
  ];
  if (harness) {
    defines.push(`-DRELAY_RUNTIME_ROOT=${harness.root}`, '-DRELAY_LAUNCHER_HARNESS=1');
  }
  defines.push(join(projectDir, 'build', 'windows', 'relay-launcher.nsi'));
  await run(makensis.path, defines, {
    cwd: join(projectDir, 'build', 'windows'),
    env: { ...process.env, ...makensis.env },
  });
  return recoveryTiming;
}

async function compileFixtureRuntime(buildId, probationDurationMs, harness) {
  await rm(fixtureAppDir, { recursive: true, force: true });
  await mkdir(dirname(fixtureIdentityPath), { recursive: true });
  const makensis = resolveMakensisCommand(await getMakeNsisPath('1.2.1'));
  const defines = [
    '-WX',
    '-INPUTCHARSET',
    'UTF8',
    `-DRELAY_FIXTURE_OUT=${fixtureExecutablePath}`,
    `-DRELAY_FIXTURE_BUILD_ID=${buildId}`,
    `-DRELAY_FIXTURE_PROBATION_DURATION_MS=${probationDurationMs}`,
  ];
  if (harness) defines.push(`-DRELAY_FIXTURE_ROOT=${harness.root}`);
  defines.push(join(projectDir, 'build', 'windows', 'relay-ci-fixture.nsi'));
  await run(makensis.path, defines, {
    cwd: join(projectDir, 'build', 'windows'),
    env: { ...process.env, ...makensis.env },
  });
  await writeFile(fixtureIdentityPath, `${buildId}\n`, 'utf8');
  for (const [relativePath, contents] of FIXTURE_RUNTIME_INTEGRITY_FILES) {
    const path = join(fixtureAppDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
  }
}

async function writeBuildDefines(harness) {
  const gitState = readGitState();
  const buildId = resolveBuildId({ env: process.env, ...gitState });
  const version = process.env.RELAY_RELEASE_VERSION || packageJson.version;
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    buildDefinesPath,
    renderBuildDefines({
      buildId,
      launcherFile,
      version,
      targetCommitish: gitState.gitSha.toLowerCase(),
      packagedAt: new Date().toISOString(),
      harnessRoot: harness?.root,
    }),
    'utf8',
  );
  await writeFile(buildIdentityPath, `${buildId}\n`, 'utf8');
  console.log(`Windows runtime build ID: ${buildId}`);
  return buildId;
}

export async function packageWindows(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    printUsage();
    return;
  }

  const harness = resolveHarnessConfig(process.env);
  const { compileOnly, fixture } = resolvePackageMode(args);
  const recoveryTiming = await compileLauncher(harness);
  if (compileOnly) return;

  const buildId = await writeBuildDefines(harness);
  if (fixture) {
    await compileFixtureRuntime(buildId, recoveryTiming.probationDurationMs, harness);
  } else {
    await stageWindowsNativeDependencies();
  }
  const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
  const forwardedArgs = resolveElectronBuilderArgs(args);
  if (fixture) {
    forwardedArgs.push('--prepackaged', fixtureAppDir);
  }
  try {
    await run(process.execPath, [
      electronBuilderCli,
      '--win',
      'nsis',
      '--x64',
      '--config',
      'electron-builder.yml',
      ...forwardedArgs,
    ]);
  } finally {
    await restoreHostNativeDependencies();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await packageWindows();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
