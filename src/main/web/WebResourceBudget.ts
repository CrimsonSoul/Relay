export class WebResourceBudget {
  private activeTotal = 0;
  private readonly activeByKey = new Map<string, number>();

  constructor(
    private readonly maxPerKey: number,
    private readonly maxTotal: number,
  ) {
    if (
      !Number.isSafeInteger(maxPerKey) ||
      maxPerKey <= 0 ||
      !Number.isSafeInteger(maxTotal) ||
      maxTotal < maxPerKey
    ) {
      throw new Error('Invalid Relay Web resource budget');
    }
  }

  tryAcquire(key: string): (() => void) | null {
    const keyCount = this.activeByKey.get(key) ?? 0;
    if (keyCount >= this.maxPerKey || this.activeTotal >= this.maxTotal) return null;

    this.activeTotal += 1;
    this.activeByKey.set(key, keyCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeTotal -= 1;
      const remaining = (this.activeByKey.get(key) ?? 1) - 1;
      if (remaining <= 0) this.activeByKey.delete(key);
      else this.activeByKey.set(key, remaining);
    };
  }
}
