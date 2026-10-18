import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockingCodeqlFindings, readSarifDirectory } from './codeql-finding-gate.mjs';

const rule = (id, securitySeverity) => ({
  id,
  properties: securitySeverity === undefined ? {} : { 'security-severity': securitySeverity },
});

const result = (ruleId, overrides = {}) => ({
  ruleId,
  level: 'warning',
  message: { text: `${ruleId} message` },
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'src/main/x.ts' }, region: { startLine: 7 } } },
  ],
  ...overrides,
});

const sarif = (rules, results, extensionRules = []) => ({
  runs: [
    {
      tool: { driver: { rules }, extensions: [{ rules: extensionRules }] },
      results,
    },
  ],
});

describe('CodeQL finding gate', () => {
  it('blocks high and critical security findings from driver or extension rules', () => {
    const findings = blockingCodeqlFindings([
      sarif(
        [rule('js/high', '7.0')],
        [result('js/high'), result('js/critical')],
        [rule('js/critical', '9.8')],
      ),
    ]);

    expect(findings).toEqual([
      { ruleId: 'js/high', severity: 7, location: 'src/main/x.ts:7', message: 'js/high message' },
      {
        ruleId: 'js/critical',
        severity: 9.8,
        location: 'src/main/x.ts:7',
        message: 'js/critical message',
      },
    ]);
  });

  it('ignores medium security findings, suppressed results, and absent baselines', () => {
    const findings = blockingCodeqlFindings([
      sarif(
        [rule('js/medium', '6.9'), rule('js/high', '8.1')],
        [
          result('js/medium', { level: 'error' }),
          result('js/high', { suppressions: [{ kind: 'inSource', status: 'accepted' }] }),
          result('js/high', { baselineState: 'absent' }),
        ],
      ),
    ]);

    expect(findings).toEqual([]);
  });

  it('keeps rejected suppressions blocking', () => {
    const findings = blockingCodeqlFindings([
      sarif(
        [rule('js/high', '8.1')],
        [result('js/high', { suppressions: [{ status: 'rejected' }] })],
      ),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('falls back to error level for rules without a security severity', () => {
    const findings = blockingCodeqlFindings([
      sarif(
        [rule('actions/error'), rule('actions/note')],
        [result('actions/error', { level: 'error' }), result('actions/note', { level: 'note' })],
      ),
    ]);

    expect(findings.map((finding) => finding.ruleId)).toEqual(['actions/error']);
  });

  it('requires at least one SARIF file in the output directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-codeql-'));
    try {
      expect(() => readSarifDirectory(directory)).toThrow(/No CodeQL SARIF output/u);
      writeFileSync(join(directory, 'javascript.sarif'), JSON.stringify(sarif([], [])));
      expect(readSarifDirectory(directory)).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
