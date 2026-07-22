import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('Windows NSIS launcher contract', () => {
  it('keeps launcher state path-based and protocol-versioned', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('!define RELAY_RUNTIME_ROOT "$LOCALAPPDATA\\Relay"');
    expect(source).toContain('$RelayRoot\\state.ini');
    expect(source).toContain('"Relay" "protocol"');
    expect(contract).toContain('--relay-launcher-probe');
    expect(contract).toContain('.relay-runtime-ready');
    expect(source).not.toMatch(/ReadINIStr[^\n]+state\.ini[^\n]+(?:path|executable)/i);
  });

  it('tries current before previous and forwards the untouched parameter string', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source.indexOf('"Relay" "current"')).toBeLessThan(source.indexOf('"Relay" "previous"'));
    expect(source).toContain('${GetParameters} $RelayArgs');
    expect(source).toContain('Exec \'"$RelayExecutable" $RelayArgs\'');
  });

  it('validates build IDs before constructing fixed runtime candidates', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('!insertmacro RelayValidateBuildId');
    expect(source).toContain('$RelayRoot\\Runtime\\$RelayBuildId\\${RELAY_INNER_EXECUTABLE}');
    expect(contract).toContain('abcdefghijklmnopqrstuvwxyz0123456789._-');
    expect(contract).toContain('abcdefghijklmnopqrstuvwxyz0123456789"');
    expect(contract).toContain('StrCpy $RelayContractFirst "${VALUE}" 1');
    expect(contract).toContain('StrCpy $RelayContractLast "${VALUE}" 1 -1');
    expect(contract).toContain('${WordFind} "${VALUE}" "." "+1" $RelayContractBase');
    expect(contract).toContain('StrCpy $RelayContractBase "${VALUE}"');
    expect(contract).toContain('$RelayContractBase == "con"');
    expect(contract).toContain('$RelayContractDevicePrefix == "com"');
    expect(contract).toContain('$RelayContractFirstFiltered == $RelayContractFirst');
    expect(contract).toContain('${If} $RelayContractLength > 64');
  });

  it('requires a protocol-1 completion marker for the selected build', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"');
    expect(source).toContain('ReadINIStr $RelayMarkerBuildId "$RelayMarker" "Relay" "buildId"');
    expect(source).toContain(
      'ReadINIStr $RelayMarkerExecutable "$RelayMarker" "Relay" "executable"',
    );
    expect(source).toContain('$RelayMarkerProtocol == "${RELAY_STATE_PROTOCOL}"');
    expect(source).toContain('$RelayMarkerBuildId == "${BUILD_ID}"');
    expect(source).toContain('$RelayMarkerExecutable == "${RELAY_INNER_EXECUTABLE}"');
  });

  it('is a non-elevating native handoff rather than another extractor', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('RequestExecutionLevel user');
    expect(source).toContain('SilentInstall silent');
    expect(source).not.toMatch(/File \/r|nsisunz|Nsis7z|WriteReg|WriteUninstaller/);
    expect(source).not.toContain('ExecWait');
  });
});

describe('Windows NSIS bootstrap contract', () => {
  it('stages before atomically activating and writes readiness last', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('.staging-');
    expect(source.indexOf('nsisunz::Unzip')).toBeLessThan(
      source.indexOf('WriteINIStr "$RelayMarker"'),
    );
    expect(source.indexOf('WriteINIStr "$RelayMarker"')).toBeLessThan(
      source.indexOf('MoveFileExW'),
    );
    expect(source).toContain('WriteINIStr "$RelayStateNew" "Relay" "current"');
    expect(source).toContain('WriteINIStr "$RelayStateNew" "Relay" "previous"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Relay" "executable"');
    expect(source).toContain('ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"');
    expect(source).toContain('CreateDirectoryW');
    expect(source).not.toContain('RMDir /r');
  });

  it('quarantines an incomplete build ID and restores it if activation fails', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('StrCpy $RelayQuarantine');
    expect(source).toContain('Rename "$RelayFinalRuntime" "$RelayQuarantine"');
    expect(source).toContain('Rename "$RelayQuarantine" "$RelayFinalRuntime"');
    expect(source.indexOf('Rename "$RelayFinalRuntime" "$RelayQuarantine"')).toBeLessThan(
      source.indexOf('Rename "$RelayStaging" "$RelayFinalRuntime"'),
    );
    expect(source).not.toContain('referenced runtime that could not be safely replaced');
    expect(source).not.toContain('RMDir /r "$RelayFinalRuntime"');
  });

  it('maintains stable per-user shortcuts without installer state', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('$DESKTOP\\Relay.lnk');
    expect(source).toContain('$SMPROGRAMS\\Relay\\Relay.lnk');
    expect(source).toContain('!define RELAY_ROOT "$LOCALAPPDATA\\Relay"');
    expect(source).toContain('StrCpy $RelayLauncher "$RelayRoot\\Relay.exe"');
    expect(source).toContain('RequestExecutionLevel user');
    expect(source).not.toMatch(/WriteReg|WriteUninstaller|RequestExecutionLevel admin/);
  });

  it('serializes preparation and preserves the active runtime on failure', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('CreateFileW');
    expect(source).toContain('bootstrap.lock');
    expect(source).toContain('ERROR_SHARING_VIOLATION');
    expect(source).not.toContain('CreateMutexW');
    expect(source).not.toContain('Local\\RelayBootstrapProtocol1');
    expect(source).toContain('BootstrapFailed:');
    expect(source).not.toContain('RMDir /r "$RelayStaging"');
    expect(source.indexOf('BootstrapFailed:')).toBeLessThan(
      source.lastIndexOf('Exec \'"$RelayLauncher" $RelayArgs\''),
    );
    expect(source).toContain('FILE_ATTRIBUTE_REPARSE_POINT');
  });

  it('passes the launcher probe without adding quotes to the parsed argument', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('ExecWait \'"$RelayLauncher" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).toContain('ExecWait \'"$RelayLauncherNew" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).not.toContain('"${RELAY_LAUNCHER_PROBE}"');
  });

  it('supports a real preparation smoke mode without a redirectable production root', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('/relay-prepare-only');
    expect(source).not.toMatch(/RELAY_TEST_ROOT|bootstrap-root|install-dir/i);
  });

  it('uses host-portable separators for compile-time project files', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain(
      '!include "${PROJECT_DIR}/build/windows/include/relay-runtime-contract.nsh"',
    );
    expect(source).not.toMatch(/\$\{(?:PROJECT_DIR|BUILD_RESOURCES_DIR)\}\\/);
  });

  it('smoke-tests first preparation, reuse, shortcuts, and data isolation', () => {
    const source = read('scripts/windows-bootstrap-smoke.ps1');

    expect(source).toContain("-ArgumentList '/relay-prepare-only'");
    expect(source.match(/Invoke-RelayPreparation/g)).toHaveLength(5);
    expect(source).toContain('LastWriteTimeUtc.Ticks');
    expect(source).toContain("GetFolderPath('Desktop')");
    expect(source).toContain("GetFolderPath('StartMenu')");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('RELAY_BOOTSTRAP_SMOKE_CONFIRM');
    expect(source).toContain('[string]$PreviousArtifact');
    expect(source).toContain('[string]$ExpectedBuildId');
    expect(source).toContain('[string]$ExpectedPreviousBuildId');
    expect(source).toContain('[IO.FileShare]::Read');
    expect(source).toContain('ConcurrentPreparation');
    expect(source).toContain("Get-IniValue -Path $statePath -Key 'previous'");
    expect(source).toContain('verify-windows-pe.mjs');
    expect(source).toContain('[Diagnostics.Stopwatch]::StartNew()');
    expect(source).toContain('FirstPreparationMs');
    expect(source).toContain('ReusePreparationMs');
    expect(source).toContain('CorruptRuntimeRepaired');
  });

  it('compiles production boundary hooks only into an isolated harness root', () => {
    const bootstrap = read('build/windows/relay-bootstrap.nsi');
    const launcher = read('build/windows/relay-launcher.nsi');
    const harness = read('scripts/windows-bootstrap-boundary-smoke.ps1');

    expect(bootstrap).toContain('!ifdef RELAY_BOOTSTRAP_HARNESS');
    expect(bootstrap).toContain('.fail-after-extraction');
    expect(bootstrap).toContain('.fail-after-marker');
    expect(bootstrap).toContain('.fail-before-runtime-rename');
    expect(bootstrap).toContain('.fail-after-quarantine');
    expect(bootstrap).toContain('.fail-before-launcher-activation');
    expect(bootstrap).toContain('.fail-before-state-activation');
    expect(launcher).toContain('RELAY_RUNTIME_ROOT');
    expect(harness).toContain('BoundaryFailuresPreservedFallback');
    expect(harness).toContain('Invoke-StableFallback');
    expect(harness).toContain('RELAY_BOOTSTRAP_BOUNDARY_CONFIRM');
    expect(harness).toContain('repair-restore-sentinel.txt');
    expect(bootstrap).not.toMatch(/bootstrap-root|install-dir/i);
  });
});

describe('Windows packaging integration contract', () => {
  it('uses the custom ZIP bootstrap instead of portable mode', () => {
    const config = read('electron-builder.yml');

    expect(config).toContain('target: nsis');
    expect(config).toContain("script: 'build/windows/relay-bootstrap.nsi'");
    expect(config).toContain('packElevateHelper: false');
    expect(config).toContain('useZip: true');
    expect(config).toContain("nsis: '1.2.1'");
    expect(config).not.toContain('target: portable');
  });

  it('gives every Windows CI artifact a commit build ID and real smoke test', () => {
    for (const file of ['.github/workflows/build.yml', '.github/workflows/release.yml']) {
      const workflow = read(file);
      const windowsJob = workflow.slice(workflow.indexOf('  package-windows:'));

      expect(windowsJob).toContain('RELAY_BUILD_ID: r1-${{ github.sha }}');
      expect(windowsJob).toContain('RELAY_BUILD_ID: r0-${{ github.sha }}');
      expect(windowsJob).toContain('scripts/windows-bootstrap-smoke.ps1');
      expect(windowsJob).toContain('-PreviousArtifact');
      expect(windowsJob).toContain('RELAY_BOOTSTRAP_SMOKE_CONFIRM: 1');
      expect(windowsJob).toContain('--scenario prepare');
      expect(windowsJob).toContain('--scenario stable');
      expect(windowsJob).toContain('--runs 5');
      expect(windowsJob).toContain('RELAY_BOOTSTRAP_BENCHMARK_CONFIRM: 1');
      expect(windowsJob).toContain('scripts/windows-bootstrap-boundary-smoke.ps1');
      expect(windowsJob).toContain('RELAY_BOOTSTRAP_HARNESS_ROOT');
      expect(windowsJob).toContain('RELAY_BOOTSTRAP_BOUNDARY_CONFIRM: 1');
    }
  });

  it('provides an opt-in same-host compression and former-portable comparison', () => {
    const workflow = read('.github/workflows/windows-startup-comparison.yml');
    const comparison = read('scripts/windows-startup-comparison.ps1');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow.split('\n').some((line) => line.trim() === 'push:')).toBe(false);
    expect(workflow).toContain('--config.compression=store');
    expect(workflow).toContain('--config.compression=normal');
    expect(workflow).toContain('--config.compression=maximum');
    expect(workflow).toContain('--win portable');
    expect(workflow).toContain('windows-startup-comparison.json');
    expect(comparison).toContain("--scenario', 'prepare'");
    expect(comparison).toContain("--scenario', 'stable'");
    expect(comparison).toContain("--scenario', 'portable'");
    expect(comparison).toContain('RecommendedCompression');
    expect(comparison).toContain('BeatsPortableBaseline');
    expect(comparison).toContain('$null');
    expect(comparison).toContain('RELAY_STARTUP_COMPARISON_CONFIRM');
  });
});
