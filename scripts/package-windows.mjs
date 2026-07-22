import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
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

function printUsage() {
  console.log(`Usage: node scripts/package-windows.mjs [electron-builder options]

Options:
  --compile-launcher-only  Compile the stable launcher without packaging Relay
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
    env: { ...(makensis.env ?? {}), NSISDIR: nsisDir },
  };
}

export function resolveElectronBuilderArgs(args) {
  const forwarded = args.filter((arg) => arg !== '--compile-launcher-only');
  const hasPublishPolicy = forwarded.some(
    (arg) => arg === '--publish' || arg.startsWith('--publish='),
  );
  return hasPublishPolicy ? forwarded : [...forwarded, '--publish', 'never'];
}

async function compileLauncher(harness) {
  await mkdir(generatedDir, { recursive: true });
  const makensis = resolveMakensisCommand(await getMakeNsisPath('1.2.1'));
  const defines = [
    '-WX',
    '-INPUTCHARSET',
    'UTF8',
    `-DRELAY_LAUNCHER_OUT=${launcherPath}`,
    `-DRELAY_LAUNCHER_ICON=${join(projectDir, 'build', 'icon.ico')}`,
  ];
  if (harness) defines.push(`-DRELAY_RUNTIME_ROOT=${harness.root}`);
  defines.push(join(projectDir, 'build', 'windows', 'relay-launcher.nsi'));
  await run(makensis.path, defines, {
    cwd: join(projectDir, 'build', 'windows'),
    env: { ...process.env, ...(makensis.env ?? {}) },
  });
}

async function writeBuildDefines(harness) {
  const buildId = resolveBuildId({ env: process.env, ...readGitState() });
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    buildDefinesPath,
    renderBuildDefines({ buildId, launcherFile, harnessRoot: harness?.root }),
    'utf8',
  );
  await writeFile(buildIdentityPath, `${buildId}\n`, 'utf8');
  console.log(`Windows runtime build ID: ${buildId}`);
}

export async function packageWindows(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    printUsage();
    return;
  }

  const harness = resolveHarnessConfig(process.env);
  const compileOnly = args.includes('--compile-launcher-only');
  await compileLauncher(harness);
  if (compileOnly) return;

  await writeBuildDefines(harness);
  const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
  const forwardedArgs = resolveElectronBuilderArgs(args);
  await run(process.execPath, [
    electronBuilderCli,
    '--win',
    'nsis',
    '--x64',
    '--config',
    'electron-builder.yml',
    ...forwardedArgs,
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageWindows().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
