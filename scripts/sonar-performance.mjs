import { appendFileSync } from 'node:fs';
import { sanitizeScannerText } from './scanner-gate-policy.mjs';

export function parseSonarSensorTimings(output, env = {}) {
  const sensors = [];
  for (const line of sanitizeScannerText(output ?? '', env).split('\n')) {
    const match = /\bSensor ([A-Za-z0-9 /.[\]_-]{1,160}) \(done\) \| time=(\d+)ms/u.exec(line);
    if (!match) continue;
    const durationMs = Number(match[2]);
    if (Number.isSafeInteger(durationMs)) sensors.push({ name: match[1], durationMs });
  }
  return sensors.sort((left, right) => right.durationMs - left.durationMs);
}

export function writeSonarPerformance({ phases, scannerOutput, env = process.env }) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const sensors = parseSonarSensorTimings(scannerOutput, env).slice(0, 10);
  const rows = (entries) =>
    entries.map(({ name, durationMs }) => `| ${name} | ${(durationMs / 1000).toFixed(2)} |`);
  const lines = [
    '### Sonar performance',
    '',
    '| Phase | Seconds |',
    '| --- | ---: |',
    ...rows(phases),
    '',
    'Sensor timings below come from the retained normal scanner output. They are part of the',
    'analysis/upload phase, not additional elapsed time. Failed phases are included.',
    '',
    '| Slowest reported sensors | Seconds |',
    '| --- | ---: |',
    ...rows(sensors),
    '',
  ];
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}
