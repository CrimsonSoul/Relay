import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSonarSensorTimings, writeSonarPerformance } from './sonar-performance.mjs';

describe('Sonar performance diagnostics', () => {
  it('ranks completed sensors without treating phase totals or progress lines as extra work', () => {
    expect(
      parseSonarSensorTimings(
        [
          'INFO Sensor JavaScript/TypeScript/CSS analysis [javascript] (done) | time=36437ms',
          'INFO Sensor JsSecuritySensorV2 [jasmin]',
          'INFO Analysis progress: 23% (150/636 files)',
          'INFO Sensor JsSecuritySensorV2 [jasmin] (done) | time=366272ms',
          'INFO Sensor incomplete (done) | time=oops',
          'INFO Sensor invalid (done) | time=999999999999999999999ms',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'JsSecuritySensorV2 [jasmin]', durationMs: 366272 },
      { name: 'JavaScript/TypeScript/CSS analysis [javascript]', durationMs: 36437 },
    ]);
  });

  it('writes bounded sanitized timings without raw scanner output or markup from logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-sonar-timing-'));
    const summary = join(root, 'summary');
    try {
      writeSonarPerformance({
        phases: [{ name: 'Scanner analysis and upload', durationMs: 454000 }],
        scannerOutput: [
          'SONAR_TOKEN=sonar-sensitive-value',
          'INFO Sensor sonar-sensitive-value (done) | time=1ms',
          'INFO Sensor <img src=x> (done) | time=1ms',
          ...Array.from(
            { length: 15 },
            (_, index) => `INFO Sensor Safe${index} (done) | time=${index}ms`,
          ),
        ].join('\n'),
        env: { GITHUB_STEP_SUMMARY: summary, SONAR_TOKEN: 'sonar-sensitive-value' },
      });
      const report = await readFile(summary, 'utf8');
      expect(report).toContain('| Scanner analysis and upload | 454.00 |');
      expect(report).toContain('| Safe14 | 0.01 |');
      expect(report).not.toContain('Safe4');
      expect(report).not.toContain('sonar-sensitive-value');
      expect(report).not.toContain('SONAR_TOKEN=');
      expect(report).not.toContain('<img');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not create output files outside GitHub summaries', () => {
    expect(() => writeSonarPerformance({ phases: [], scannerOutput: '', env: {} })).not.toThrow();
  });
});
