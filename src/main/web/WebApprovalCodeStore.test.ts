import { describe, expect, it } from 'vitest';
import { WebApprovalCodeStore } from './WebApprovalCodeStore';

describe('WebApprovalCodeStore', () => {
  const createStore = () => {
    let now = Date.parse('2026-07-20T12:00:00.000Z');
    let nextCode = 123456;
    const store = new WebApprovalCodeStore({
      now: () => now,
      randomCode: () => String(nextCode++),
      createId: () => `request-${nextCode}`,
    });
    return {
      store,
      advance: (milliseconds: number) => {
        now += milliseconds;
      },
    };
  };

  it('keeps codes redacted until the desktop explicitly generates one', () => {
    const { store } = createStore();
    const request = store.request({
      sessionId: 'browser-a',
      operation: 'initial-owner-credential',
      sourceLabel: 'Chrome from 10.0.0.8',
    });

    expect(request.operation).toBe('initial-owner-credential');
    expect(request).not.toHaveProperty('code');
    expect(store.listPending()).toEqual([request]);
    expect(JSON.stringify(store)).not.toContain('123456');

    const issued = store.generate(request.requestId);
    expect(issued).toEqual({ request, code: '123456' });
    expect(store.listPending()).toEqual([request]);
    expect(store.get(request.requestId)).toEqual(request);
  });

  it('binds one-use approval to the exact session and operation', () => {
    const { store } = createStore();
    const request = store.request({
      sessionId: 'browser-a',
      operation: 'initial-owner-credential',
      sourceLabel: 'Safari from 10.0.0.9',
    });
    const code = store.generate(request.requestId)!.code;

    expect(
      store.consume({
        requestId: request.requestId,
        sessionId: 'browser-b',
        operation: 'initial-owner-credential',
        code,
      }),
    ).toBe(false);
    expect(
      store.consume({
        requestId: request.requestId,
        sessionId: 'browser-a',
        operation: 'credential-recovery',
        code,
      }),
    ).toBe(false);
    expect(
      store.consume({
        requestId: request.requestId,
        sessionId: 'browser-a',
        operation: 'initial-owner-credential',
        code,
      }),
    ).toBe(true);
    expect(
      store.consume({
        requestId: request.requestId,
        sessionId: 'browser-a',
        operation: 'initial-owner-credential',
        code,
      }),
    ).toBe(false);
    expect(store.listPending()).toEqual([]);
  });

  it('expires, cancels, clears by session, and starts empty after restart', () => {
    const { store, advance } = createStore();
    const expired = store.request({
      sessionId: 'browser-a',
      operation: 'credential-recovery',
      sourceLabel: 'Edge from 10.0.0.10',
    });
    const expiredCode = store.generate(expired.requestId)!.code;
    advance(10 * 60 * 1_000);
    expect(
      store.consume({
        requestId: expired.requestId,
        sessionId: 'browser-a',
        operation: 'credential-recovery',
        code: expiredCode,
      }),
    ).toBe(false);

    const cancelled = store.request({
      sessionId: 'browser-a',
      operation: 'credential-recovery',
      sourceLabel: 'Edge from 10.0.0.10',
    });
    expect(store.cancel(cancelled.requestId)).toBe(true);
    expect(store.generate(cancelled.requestId)).toBeNull();

    store.request({
      sessionId: 'browser-a',
      operation: 'initial-owner-credential',
      sourceLabel: 'Chrome from 10.0.0.8',
    });
    store.request({
      sessionId: 'browser-b',
      operation: 'credential-recovery',
      sourceLabel: 'Safari from 10.0.0.9',
    });
    store.clearSession('browser-a');
    expect(store.listPending().map(({ sourceLabel }) => sourceLabel)).toEqual([
      'Safari from 10.0.0.9',
    ]);

    expect(new WebApprovalCodeStore().listPending()).toEqual([]);
  });

  it('invalidates a request after five failed code attempts', () => {
    const { store } = createStore();
    const request = store.request({
      sessionId: 'browser-a',
      operation: 'credential-recovery',
      sourceLabel: 'Chrome from 10.0.0.8',
    });
    const code = store.generate(request.requestId)!.code;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        store.consume({
          requestId: request.requestId,
          sessionId: 'browser-a',
          operation: 'credential-recovery',
          code: '000000',
        }),
      ).toBe(false);
    }
    expect(
      store.consume({
        requestId: request.requestId,
        sessionId: 'browser-a',
        operation: 'credential-recovery',
        code,
      }),
    ).toBe(false);
    expect(store.listPending()).toEqual([]);
  });
});
