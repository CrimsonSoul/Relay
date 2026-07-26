import { describe, expect, it } from 'vitest';
import { WebResourceBudget } from './WebResourceBudget';

describe('WebResourceBudget', () => {
  it('enforces the global cap across keys and releases each permit exactly once', () => {
    const budget = new WebResourceBudget(2, 2);
    const releaseFirst = budget.tryAcquire('session-a');
    const releaseSecond = budget.tryAcquire('session-b');

    expect(releaseFirst).not.toBeNull();
    expect(releaseSecond).not.toBeNull();
    expect(budget.tryAcquire('session-c')).toBeNull();

    releaseFirst!();
    releaseFirst!();
    expect(budget.tryAcquire('session-c')).not.toBeNull();
  });
});
