import { describe, expect, it } from 'vitest';
import { extractLatestStartupTimeline, median } from './startup-benchmark-utils.mjs';

describe('startup benchmark utilities', () => {
  it('calculates the median for odd and even samples without mutating input', () => {
    const samples = [900, 100, 500, 300];

    expect(median(samples)).toBe(400);
    expect(samples).toEqual([900, 100, 500, 300]);
    expect(median([9, 1, 5])).toBe(5);
  });

  it('rejects an empty benchmark sample', () => {
    expect(() => median([])).toThrow('at least one sample');
  });

  it('extracts the most recent complete Relay startup timeline', () => {
    const log = [
      '[INFO] Relay startup timing {"entry":0,"window-created":80,"renderer-mounted":400}',
      '[INFO] unrelated message',
      '[INFO] Relay startup timing {"entry":0,"window-created":40,"workspace-ready":210,"renderer-mounted":260}',
    ].join('\n');

    expect(extractLatestStartupTimeline(log)).toEqual({
      entry: 0,
      'window-created': 40,
      'workspace-ready': 210,
      'renderer-mounted': 260,
    });
  });

  it('ignores truncated or malformed startup summaries', () => {
    expect(
      extractLatestStartupTimeline(
        '[INFO] Relay startup timing {"entry":0\n[INFO] Relay startup timing not-json',
      ),
    ).toBeNull();
  });
});
