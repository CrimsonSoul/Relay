import { afterEach, describe, expect, it, vi } from 'vitest';
import { quotedString, readBoundedJson, retryAfterMs } from './DynatraceProtocol';

describe('Dynatrace protocol helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('quotes strings with backslash and double-quote escapes', () => {
    expect(quotedString('POS "Store" \\ NOC')).toBe(String.raw`"POS \"Store\" \\ NOC"`);
  });

  it('reads Retry-After as seconds or an HTTP date, never negative', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const after = (value?: string) =>
      retryAfterMs(new Headers(value === undefined ? {} : { 'retry-after': value }));

    expect(after('2.5')).toBe(2_500);
    expect(after('-5')).toBe(0);
    expect(after('Sat, 17 Oct 2026 12:00:30 GMT')).toBe(30_000);
    expect(after('Sat, 17 Oct 2026 11:00:00 GMT')).toBe(0);
    expect(after('soon')).toBeNull();
    expect(after()).toBeNull();
  });

  it('reads a bounded JSON body and names the response in errors', async () => {
    const signal = new AbortController().signal;
    await expect(
      readBoundedJson(new Response('{"ok":true}'), signal, 64, 'live response'),
    ).resolves.toEqual({ ok: true });
    await expect(
      readBoundedJson(new Response('x'.repeat(65)), signal, 64, 'live response'),
    ).rejects.toThrow('Dynatrace live response exceeded its size limit.');
    await expect(readBoundedJson(new Response('{'), signal, 64, 'live response')).rejects.toThrow(
      'Dynatrace returned invalid JSON in a live response.',
    );
    await expect(readBoundedJson(new Response(null), signal, 64, 'live response')).rejects.toThrow(
      'Dynatrace returned an empty live response.',
    );
  });
});
