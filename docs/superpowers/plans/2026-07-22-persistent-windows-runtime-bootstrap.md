# Persistent Windows Runtime Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's temporary Windows portable wrapper with a one-file, per-user bootstrap that extracts each build once and preserves stable Desktop and Start Menu launch paths.

**Architecture:** A Node packaging driver validates a content identity, compiles a tiny NSIS launcher with electron-builder's pinned toolchain, and invokes a custom NSIS target. The outer bootstrap stages the Electron payload under `%LOCALAPPDATA%\Relay\Runtime`, atomically activates it through `state.ini`, maintains stable shortcuts, and launches the small installed launcher. Relay later removes unreferenced runtime directories outside the startup-critical path.

**Tech Stack:** Node.js ESM, Vitest, Electron 42, electron-builder 26, NSIS 3, GitHub Actions, PowerShell.

## Global Constraints

- The published artifact remains one unsigned `Relay.exe` and requests `asInvoker` execution.
- Runtime files live only under `%LOCALAPPDATA%\Relay`; Relay data remains under `%APPDATA%\Relay\data`.
- The bootstrap creates no registry installation, service, scheduled task, or uninstaller.
- Build IDs match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; package version `1.0.0` is not an identity.
- `state.ini` protocol 1 stores validated `current` and `previous` build IDs, never executable paths.
- Extraction always targets a unique staging directory and writes `.relay-runtime-ready` last.
- Desktop and Start Menu shortcuts both target `%LOCALAPPDATA%\Relay\Relay.exe`.
- The previous complete runtime remains launchable after any failed update boundary.
- Production code follows red-green TDD; configuration and generated NSIS files are covered by contract and packaged Windows tests.
- Execute this plan directly with the primary agent per the repository working agreement; do not add per-task subagent loops.

---

### Task 1: Build identity and packaging driver

**Files:**

- Create: `scripts/windows-package-contract.mjs`
- Create: `scripts/windows-package-contract.test.mjs`
- Create: `scripts/package-windows.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `validateBuildId(value): string`, `resolveBuildId({ env, gitSha, dirty, nonce }): string`, and `renderBuildDefines({ buildId, launcherPath }): string`.
- Produces: a packaging CLI that compiles `build/windows/relay-launcher.nsi` and invokes electron-builder's `nsis` target while forwarding CLI overrides such as `--config.compression=store`.
- Consumes later: `release/windows-bootstrap/relay-build.nsh` and `release/windows-bootstrap/RelayLauncher.exe` are read by the outer NSIS script.

- [ ] **Step 1: Write failing contract tests**

```js
it('accepts only bounded path-safe build identifiers', () => {
  expect(validateBuildId('r1-7e97e422')).toBe('r1-7e97e422');
  for (const value of ['', '../build', 'C:\\Relay', 'build id', `r1-${'a'.repeat(64)}`]) {
    expect(() => validateBuildId(value)).toThrow(/build id/i);
  }
});

it('makes dirty local builds unique without changing clean CI identity', () => {
  expect(resolveBuildId({ env: { RELAY_BUILD_ID: 'r1-ci' } })).toBe('r1-ci');
  expect(
    resolveBuildId({ env: {}, gitSha: '7e97e422abcd', dirty: true, nonce: 'abc123' }),
  ).toBe('r1-7e97e422abcd-dirty-abc123');
});

it('escapes generated NSIS defines and records the launcher input', () => {
  expect(renderBuildDefines({ buildId: 'r1-abc', launcherPath: 'RelayLauncher.exe' })).toBe(
    '!define RELAY_BUILD_ID "r1-abc"\n!define RELAY_LAUNCHER_FILE "RelayLauncher.exe"\n',
  );
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/windows-package-contract.test.mjs`

Expected: FAIL because `windows-package-contract.mjs` does not exist.

- [ ] **Step 3: Implement the minimal validated contract and packaging CLI**

```js
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateBuildId(value) {
  if (typeof value !== 'string' || !BUILD_ID.test(value)) {
    throw new Error('Windows package build ID must be 1-64 path-safe ASCII characters');
  }
  return value;
}

export function resolveBuildId({ env, gitSha, dirty = false, nonce = Date.now().toString(36) }) {
  if (env.RELAY_BUILD_ID) return validateBuildId(env.RELAY_BUILD_ID);
  if (!/^[0-9a-f]{7,40}$/i.test(gitSha ?? '')) throw new Error('Missing Git build identity');
  return validateBuildId(`r1-${gitSha.slice(0, 16)}${dirty ? `-dirty-${nonce}` : ''}`);
}
```

The CLI uses `getMakeNsisPath()` from the pinned `app-builder-lib` package, passes paths as separate spawn arguments, writes generated files only beneath ignored `release/windows-bootstrap`, and propagates nonzero child exit codes.

- [ ] **Step 4: Verify GREEN and package-script wiring**

Run: `npx vitest run scripts/windows-package-contract.test.mjs`

Expected: PASS.

Run: `node scripts/package-windows.mjs --help`

Expected: prints the local packaging usage without compiling or writing an artifact.

- [ ] **Step 5: Commit the behavior slice**

```bash
git add scripts/windows-package-contract.mjs scripts/windows-package-contract.test.mjs scripts/package-windows.mjs package.json
git commit -m "build: add persistent Windows package driver"
```

### Task 2: Stable launcher contract

**Files:**

- Create: `build/windows/include/relay-runtime-contract.nsh`
- Create: `build/windows/relay-launcher.nsi`
- Create: `scripts/windows-nsis-contract.test.mjs`

**Interfaces:**

- Produces: `!insertmacro RelayValidateBuildId VALUE RESULT`, shared by launcher and bootstrap.
- Produces: launcher probe `--relay-launcher-probe` with protocol exit code `101`.
- Consumes: `%LOCALAPPDATA%\Relay\state.ini`, `.relay-runtime-ready`, and the inner `Relay.exe`.

- [ ] **Step 1: Write failing source-contract tests**

```js
it('keeps launcher state path-based and protocol-versioned', () => {
  const source = readFileSync('build/windows/relay-launcher.nsi', 'utf8');
  expect(source).toContain('$LOCALAPPDATA\\Relay\\state.ini');
  expect(source).toContain('protocol');
  expect(source).toContain('--relay-launcher-probe');
  expect(source).toContain('.relay-runtime-ready');
  expect(source).not.toMatch(/ReadINIStr[^\n]+(?:path|executable)/i);
});

it('tries current before previous and forwards the untouched parameter string', () => {
  const source = readFileSync('build/windows/relay-launcher.nsi', 'utf8');
  expect(source.indexOf('current')).toBeLessThan(source.indexOf('previous'));
  expect(source).toContain('${GetParameters} $RelayArgs');
  expect(source).toContain('Exec \'"$RelayExecutable" $RelayArgs\'');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: FAIL because the launcher source does not exist.

- [ ] **Step 3: Implement the shared validator and launcher**

The launcher must be silent, request user execution, use the Relay icon, validate protocol `1`, validate each build ID character against `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, and construct candidates only as:

```nsi
StrCpy $RelayExecutable "$LOCALAPPDATA\Relay\Runtime\$RelayBuildId\Relay.exe"
StrCpy $RelayMarker "$LOCALAPPDATA\Relay\Runtime\$RelayBuildId\.relay-runtime-ready"
```

It tries `current`, then `previous`, uses `Exec` rather than `ExecWait`, and shows `Relay needs to be prepared again.` only when neither candidate starts.

- [ ] **Step 4: Verify GREEN and compile the launcher**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: PASS.

Run: `node scripts/package-windows.mjs --compile-launcher-only`

Expected: exits 0 and creates `release/windows-bootstrap/RelayLauncher.exe`.

- [ ] **Step 5: Commit the behavior slice**

```bash
git add build/windows scripts/windows-nsis-contract.test.mjs
git commit -m "feat: add stable Windows runtime launcher"
```

### Task 3: Atomic persistent bootstrap

**Files:**

- Create: `build/windows/relay-bootstrap.nsi`
- Extend: `scripts/windows-nsis-contract.test.mjs`
- Create: `scripts/windows-bootstrap-smoke.ps1`

**Interfaces:**

- Consumes: electron-builder defines `APP_64`, `APP_64_HASH`, `APP_EXECUTABLE_FILENAME`, `PROJECT_DIR`, and the generated `relay-build.nsh`.
- Produces: `%LOCALAPPDATA%\Relay\Runtime\<build-id>`, protocol 1 state, stable launcher, Desktop shortcut, and Start Menu shortcut.
- Produces: `/relay-prepare-only` for packaged CI smoke tests; it performs the real preparation but does not start Electron.

- [ ] **Step 1: Add failing bootstrap contract tests**

```js
it('stages before atomically activating and writes readiness last', () => {
  const source = readFileSync('build/windows/relay-bootstrap.nsi', 'utf8');
  expect(source).toContain('.staging-');
  expect(source.indexOf('nsisunz::Unzip')).toBeLessThan(source.indexOf('.relay-runtime-ready'));
  expect(source.indexOf('.relay-runtime-ready')).toBeLessThan(source.indexOf('MoveFileExW'));
});

it('maintains stable per-user shortcuts without installer state', () => {
  const source = readFileSync('build/windows/relay-bootstrap.nsi', 'utf8');
  expect(source).toContain('$DESKTOP\\Relay.lnk');
  expect(source).toContain('$SMPROGRAMS\\Relay\\Relay.lnk');
  expect(source).toContain('$LOCALAPPDATA\\Relay\\Relay.exe');
  expect(source).not.toMatch(/WriteReg|WriteUninstaller|RequestExecutionLevel admin/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: FAIL because `relay-bootstrap.nsi` does not exist.

- [ ] **Step 3: Implement staging, validation, activation, fallback, and shortcut updates**

The custom script embeds the ZIP payload with compression disabled around the `File` instruction, extracts with `nsisunz::Unzip`, validates `Relay.exe`, writes a marker containing `buildId`, `protocol`, and `${APP_64_HASH}`, and renames staging to the final directory. It probes or atomically installs the launcher before atomically replacing state with:

```nsi
WriteINIStr "$RelayStateNew" "Relay" "protocol" "1"
WriteINIStr "$RelayStateNew" "Relay" "current" "${RELAY_BUILD_ID}"
WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayCurrent"
System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9)i.r0'
```

Every error label destroys the progress banner, removes only the unique staging directory, leaves state untouched, and starts the prior valid launcher after showing the bounded error. The success path refreshes both shortcuts and launches the stable launcher unless `/relay-prepare-only` was supplied.

- [ ] **Step 4: Verify GREEN and PowerShell smoke assertions**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: PASS.

On Windows, run: `pwsh -File scripts/windows-bootstrap-smoke.ps1 -Artifact release/Relay.exe`

Expected: first run creates one complete runtime and both stable shortcuts; second run leaves the runtime marker timestamp unchanged; a `%APPDATA%\Relay\data` sentinel remains byte-identical.

- [ ] **Step 5: Commit the behavior slice**

```bash
git add build/windows/relay-bootstrap.nsi scripts/windows-nsis-contract.test.mjs scripts/windows-bootstrap-smoke.ps1
git commit -m "feat: add persistent Windows runtime bootstrap"
```

### Task 4: electron-builder and CI integration

**Files:**

- Modify: `electron-builder.yml`
- Modify: `.github/workflows/build.yml`
- Modify: `.github/workflows/release.yml`
- Extend: `scripts/windows-nsis-contract.test.mjs`

**Interfaces:**

- `electron-builder.yml` changes the Windows target from `portable` to `nsis`, uses `build/windows/relay-bootstrap.nsi`, sets `packElevateHelper: false`, `useZip: true`, and retains `Relay.exe` plus `requestedExecutionLevel: asInvoker`.
- Both Windows CI jobs provide `RELAY_BUILD_ID: r1-${{ github.sha }}` and execute the real bootstrap smoke script after packaging.

- [ ] **Step 1: Add failing integration-config tests**

```js
it('uses the custom non-elevating bootstrap instead of portable mode', () => {
  const config = readFileSync('electron-builder.yml', 'utf8');
  expect(config).toContain('target: nsis');
  expect(config).toContain("script: 'build/windows/relay-bootstrap.nsi'");
  expect(config).toContain('packElevateHelper: false');
  expect(config).not.toContain('target: portable');
});

it('gives every Windows CI artifact a commit build ID and smoke test', () => {
  for (const file of ['.github/workflows/build.yml', '.github/workflows/release.yml']) {
    const workflow = readFileSync(file, 'utf8');
    expect(workflow).toContain('RELAY_BUILD_ID: r1-${{ github.sha }}');
    expect(workflow).toContain('scripts/windows-bootstrap-smoke.ps1');
  }
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: FAIL because Windows still targets `portable` and CI does not set the identity or smoke-test the artifact.

- [ ] **Step 3: Apply packaging and workflow configuration**

Keep branch builds on `--config.compression=store` for fast test feedback. Release packaging initially uses `normal` ZIP compression, and the packaged benchmark records a comparison with `store` and the old `maximum` artifact before the production compression decision is finalized.

- [ ] **Step 4: Verify GREEN and YAML/package consistency**

Run: `npx vitest run scripts/windows-nsis-contract.test.mjs`

Expected: PASS.

Run: `npm run lint && npm run format:check`

Expected: PASS.

- [ ] **Step 5: Commit the behavior slice**

```bash
git add electron-builder.yml .github/workflows/build.yml .github/workflows/release.yml scripts/windows-nsis-contract.test.mjs
git commit -m "ci: package persistent Windows runtime"
```

### Task 5: Deferred safe runtime cleanup

**Files:**

- Create: `src/main/app/windowsRuntimeCleanup.ts`
- Create: `src/main/app/__tests__/windowsRuntimeCleanup.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Produces: `cleanupWindowsRuntimes(options): Promise<CleanupResult>` and `scheduleWindowsRuntimeCleanup(options?): () => void`.
- Consumes: fixed `%LOCALAPPDATA%\Relay\Runtime`, protocol 1 state, current `process.execPath`, and a five-minute post-readiness delay.

- [ ] **Step 1: Write failing cleanup tests**

```ts
it('removes only unreferenced real directories beneath the runtime root', async () => {
  const result = await cleanupWindowsRuntimes({ root, execPath: currentExe, now });
  expect(result.removed).toEqual(['orphan-build']);
  expect(existsSync(currentDir)).toBe(true);
  expect(existsSync(previousDir)).toBe(true);
  expect(existsSync(outsideTarget)).toBe(true);
});

it('skips symlinks, malformed state entries, and fresh staging directories', async () => {
  const result = await cleanupWindowsRuntimes({ root, execPath: currentExe, now });
  expect(result.skipped).toEqual(expect.arrayContaining(['link-build', '.staging-current']));
});

it('schedules cleanup after readiness and returns a cancellation function', () => {
  const cancel = scheduleWindowsRuntimeCleanup({ delayMs: 300_000, setTimer, clearTimer });
  expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 300_000);
  cancel();
  expect(clearTimer).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run src/main/app/__tests__/windowsRuntimeCleanup.test.ts`

Expected: FAIL because the cleanup module does not exist.

- [ ] **Step 3: Implement bounded cleanup and lifecycle wiring**

Only run on packaged Windows when `process.execPath` resolves to a validated runtime build beneath the fixed root. Preserve state `current`, `previous`, and the executing build. Use `lstat` and skip symbolic links/reparse candidates. Remove unreferenced validated build directories and staging directories older than 24 hours; catch per-directory failures and log a bounded summary. Schedule after workspace readiness and cancel in `cleanupAppResources()`.

- [ ] **Step 4: Verify GREEN and startup lifecycle regression coverage**

Run: `npx vitest run src/main/app/__tests__/windowsRuntimeCleanup.test.ts src/main/app/startupSequence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the behavior slice**

```bash
git add src/main/app/windowsRuntimeCleanup.ts src/main/app/__tests__/windowsRuntimeCleanup.test.ts src/main/index.ts
git commit -m "perf: defer Windows runtime cleanup"
```

### Task 6: Complete packaged benchmark and verification

**Files:**

- Modify: `scripts/benchmark-startup.mjs`
- Modify: `scripts/startup-benchmark-utils.mjs`
- Modify: `scripts/startup-benchmark-utils.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-22-persistent-windows-runtime-design.md` only if measured behavior requires a clarified acceptance note.

**Interfaces:**

- Produces: benchmark modes `--artifact <Relay.exe> --scenario prepare` and `--launcher <path> --scenario stable` on Windows.
- Records: outer process start, preparation completion/handoff, existing Electron milestones, runtime reuse, artifact size, and compression label.

- [ ] **Step 1: Write failing packaged-benchmark tests**

```js
it('does not label an unpackaged second launch as post-update', () => {
  expect(() => parseStartupBenchmarkArgs(['--scenario', 'prepare'])).toThrow(/artifact/i);
});

it('builds distinct prepare and stable launch commands', () => {
  expect(buildLaunchSpec({ scenario: 'prepare', artifact: 'Relay.exe' }).command).toBe('Relay.exe');
  expect(buildLaunchSpec({ scenario: 'stable', launcher: 'InstalledRelay.exe' }).command).toBe(
    'InstalledRelay.exe',
  );
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/startup-benchmark-utils.test.mjs`

Expected: FAIL because packaged scenarios are not supported.

- [ ] **Step 3: Implement packaged scenario parsing and reporting**

Retain the current unpackaged development benchmark under an explicit `development` scenario. Refuse `prepare` without a Windows artifact and `stable` without a launcher. Never delete `%APPDATA%\Relay\data`; test preparation uses only the disposable Windows CI profile or an explicitly confirmed manual test machine.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
npx vitest run scripts/windows-package-contract.test.mjs scripts/windows-nsis-contract.test.mjs scripts/startup-benchmark-utils.test.mjs src/main/app/__tests__/windowsRuntimeCleanup.test.ts
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run package:win -- --config.compression=store
```

Expected: every command exits 0. On Windows, `scripts/windows-bootstrap-smoke.ps1` passes against `release/Relay.exe`, the PE execution level is non-elevating, and prepare/stable benchmark results are attached to the handoff.

- [ ] **Step 5: Obtain one independent final review and commit fixes**

Review scope: the complete diff against the approved spec, especially NSIS quoting, atomic state replacement, traversal protection, shortcut stability, update-while-running behavior, and destructive cleanup boundaries. Apply any validated findings, rerun the affected focused tests, then rerun the complete verification suite.

- [ ] **Step 6: Commit the verified final slice**

```bash
git add scripts/benchmark-startup.mjs scripts/startup-benchmark-utils.mjs scripts/startup-benchmark-utils.test.mjs
git commit -m "perf: benchmark packaged Windows startup"
```
