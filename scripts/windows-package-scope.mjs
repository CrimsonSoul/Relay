import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Paths the packaged Windows app ships, bootstraps, or updates through. A pull request that
// touches any of them runs the full Windows package, bootstrap, and updater verification.
export const WINDOWS_PACKAGE_PATHS = Object.freeze([
  '.github/workflows/reusable-windows-package.yml',
  '.node-version',
  'build/',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'package-lock.json',
  'package.json',
  'resources/pocketbase/',
  'scripts/benchmark-startup.mjs',
  'scripts/download-pocketbase.mjs',
  'scripts/find-previous-windows-artifact.ps1',
  'scripts/package-windows.mjs',
  'scripts/startup-benchmark-utils.mjs',
  'scripts/verify-packaged-windows-sqlite.mjs',
  'scripts/verify-windows-native-modules.mjs',
  'scripts/verify-windows-pe.mjs',
  'scripts/windows-bootstrap-boundary-smoke.ps1',
  'scripts/windows-bootstrap-smoke.ps1',
  'scripts/windows-package-contract.mjs',
  'scripts/windows-package-scope.mjs',
  'src/main/app/',
  'src/main/index.ts',
  'src/main/pocketbase/',
  'src/main/power/',
  'src/main/releases/',
]);

export const touchesWindowsPackage = (files) =>
  files.some((file) =>
    WINDOWS_PACKAGE_PATHS.some((path) =>
      path.endsWith('/') ? file.startsWith(path) : file === path,
    ),
  );

// Pull requests run the package only when they touch a Windows package path. Manual dispatch
// always runs it; a `main` push does not, because the Release workflow packages releasable merges
// and the pull request already verified the same tree.
export function windowsPackageRequired(eventName, changedFiles) {
  if (eventName === 'workflow_dispatch') return true;
  if (eventName === 'push') return false;
  if (eventName !== 'pull_request') throw new Error(`Unsupported event: ${eventName}`);
  if (!Array.isArray(changedFiles)) throw new Error('Pull request changed files are required.');
  return touchesWindowsPackage(changedFiles);
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const listPath = process.argv[2];
  const changedFiles =
    eventName === 'pull_request'
      ? readFileSync(listPath, 'utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : undefined;
  const required = windowsPackageRequired(eventName, changedFiles);
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`, 'utf8');
  console.log(`Windows package verification required: ${required}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
