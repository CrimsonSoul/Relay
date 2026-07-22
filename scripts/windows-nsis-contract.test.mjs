import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('Windows NSIS launcher contract', () => {
  it('keeps launcher state path-based and protocol-versioned', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('$LOCALAPPDATA\\Relay\\state.ini');
    expect(source).toContain('"Relay" "protocol"');
    expect(contract).toContain('--relay-launcher-probe');
    expect(contract).toContain('.relay-runtime-ready');
    expect(source).not.toMatch(/ReadINIStr[^\n]+(?:path|executable)/i);
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
    expect(source).toContain(
      '$LOCALAPPDATA\\Relay\\Runtime\\$RelayBuildId\\${RELAY_INNER_EXECUTABLE}',
    );
    expect(contract).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-');
    expect(contract).toContain('${If} $RelayContractLength > 64');
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
  });

  it('maintains stable per-user shortcuts without installer state', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('$DESKTOP\\Relay.lnk');
    expect(source).toContain('$SMPROGRAMS\\Relay\\Relay.lnk');
    expect(source).toContain('$LOCALAPPDATA\\Relay\\Relay.exe');
    expect(source).toContain('RequestExecutionLevel user');
    expect(source).not.toMatch(/WriteReg|WriteUninstaller|RequestExecutionLevel admin/);
  });

  it('serializes preparation and preserves the active runtime on failure', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('CreateMutexW');
    expect(source).toContain('ERROR_ALREADY_EXISTS');
    expect(source).toContain('BootstrapFailed:');
    expect(source).toContain('RMDir /r "$RelayStaging"');
    expect(source.indexOf('BootstrapFailed:')).toBeLessThan(
      source.lastIndexOf('Exec \'"$RelayLauncher" $RelayArgs\''),
    );
  });

  it('passes the launcher probe without adding quotes to the parsed argument', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('ExecWait \'"$RelayLauncher" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).toContain('ExecWait \'"$RelayLauncherNew" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).not.toContain('\"${RELAY_LAUNCHER_PROBE}\"');
  });

  it('supports a real preparation smoke mode without a redirectable production root', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('/relay-prepare-only');
    expect(source).not.toMatch(/RELAY_(?:TEST_)?ROOT|bootstrap-root|install-dir/i);
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
    expect(source.match(/Invoke-RelayPreparation/g)).toHaveLength(3);
    expect(source).toContain('LastWriteTimeUtc.Ticks');
    expect(source).toContain("GetFolderPath('Desktop')");
    expect(source).toContain("GetFolderPath('StartMenu')");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('RELAY_BOOTSTRAP_SMOKE_CONFIRM');
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
      expect(windowsJob).toContain('scripts/windows-bootstrap-smoke.ps1');
      expect(windowsJob).toContain('RELAY_BOOTSTRAP_SMOKE_CONFIRM: 1');
    }
  });
});
