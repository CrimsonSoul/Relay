import { describe, expect, it } from 'vitest';
import { createStartupTimeline } from './startupTimeline';

describe('startup timeline', () => {
  it('records each milestone once using monotonic elapsed time', () => {
    const values = [100, 125, 140, 170];
    const timeline = createStartupTimeline(() => values.shift() ?? 170);

    expect(timeline.mark('electron-ready')).toBe(25);
    expect(timeline.mark('electron-ready')).toBe(25);
    expect(timeline.mark('window-created')).toBe(40);

    expect(timeline.toJSON()).toEqual({
      entry: 0,
      'electron-ready': 25,
      'window-created': 40,
    });
  });

  it('never reports negative elapsed time when an injected clock regresses', () => {
    const values = [100, 90];
    const timeline = createStartupTimeline(() => values.shift() ?? 90);

    expect(timeline.mark('electron-ready')).toBe(0);
  });

  it('emits a single bounded machine-readable summary', () => {
    let now = 10;
    const timeline = createStartupTimeline(() => now++);
    timeline.mark('electron-ready');
    timeline.mark('window-created');

    const first = timeline.takeSummary();
    expect(first).toMatch(/^Relay startup timing /);
    expect(first.length).toBeLessThanOrEqual(1_200);
    expect(timeline.takeSummary()).toBeNull();
  });
});
