import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const radarCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/tabs/radar.css'), 'utf8');

describe('Radar layout CSS', () => {
  it('places a bounded health rail before flexible dispatcher lanes', () => {
    expect(radarCss).toMatch(
      /\.radar-tab\s*{[^}]*container-name:\s*radar;[^}]*container-type:\s*inline-size;/s,
    );
    expect(radarCss).toMatch(
      /\.radar-workspace\s*{[^}]*grid-template-columns:\s*minmax\(240px,\s*280px\)\s+minmax\(0,\s*1fr\);/s,
    );
    expect(radarCss).toMatch(
      /\.radar-health-rail\s*{[^}]*border-right:\s*1px solid var\(--color-border\);/s,
    );
  });

  it('stacks the rail above lanes at narrow Radar content widths', () => {
    expect(radarCss).toMatch(
      /@container radar \(max-width:\s*720px\)[\s\S]*?\.radar-workspace\s*{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(radarCss).toMatch(
      /@container radar \(max-width:\s*720px\)[\s\S]*?\.radar-health-rail\s*{[^}]*border-right:\s*0;[^}]*border-bottom:\s*1px solid var\(--color-border\);/,
    );
  });

  it('contains long queue names without horizontal overflow', () => {
    expect(radarCss).toMatch(/\.radar-table\s*{[^}]*table-layout:\s*fixed;/s);
    expect(radarCss).toMatch(
      /\.radar-table-name\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(radarCss).toMatch(/\.radar-lane-grid\s*{[^}]*min-width:\s*0;/s);
  });
});
