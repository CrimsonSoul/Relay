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

    expect(source.indexOf('"Relay" "current"')).toBeLessThan(
      source.indexOf('"Relay" "previous"'),
    );
    expect(source).toContain('${GetParameters} $RelayArgs');
    expect(source).toContain("Exec '\"$RelayExecutable\" $RelayArgs'");
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
