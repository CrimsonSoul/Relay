import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupSecurityHeaders } from '../securityHeaders';

// Capture the onHeadersReceived callback
let headersCallback: Function;

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn((cb: Function) => {
          headersCallback = cb;
        }),
      },
    },
  },
}));

let mockAppConfig: { load: () => Record<string, unknown> | undefined } | null = null;
vi.mock('../appState', () => ({
  getAppConfig: () => mockAppConfig,
}));

/** Helper: invoke the onHeadersReceived handler and return the response headers */
function getResponseHeaders(
  details: { responseHeaders?: Record<string, string[]> } = {},
): Record<string, string[]> {
  let result: Record<string, string[]> = {};
  headersCallback(details, (response: { responseHeaders: Record<string, string[]> }) => {
    result = response.responseHeaders;
  });
  return result;
}

describe('setupSecurityHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CSP in production mode (isDev=false)', () => {
    beforeEach(() => {
      setupSecurityHeaders(false);
    });

    it('does not include unsafe-eval in script-src', () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      expect(csp).not.toContain("'unsafe-eval'");
    });

    it('does not include unsafe-inline in script-src', () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      // Extract the script-src directive specifically
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('includes a sha256 hash for script-src in production', () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
      expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
    });
  });

  describe('CSP in development mode (isDev=true)', () => {
    beforeEach(() => {
      setupSecurityHeaders(true);
    });

    it('includes unsafe-eval in script-src for HMR', () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
      expect(scriptSrc).toContain("'unsafe-eval'");
    });

    it('includes unsafe-inline in script-src for dev', () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
      expect(scriptSrc).toContain("'unsafe-inline'");
    });
  });

  describe('security response headers', () => {
    beforeEach(() => {
      setupSecurityHeaders(false);
    });

    it('sets X-Content-Type-Options to nosniff', () => {
      const headers = getResponseHeaders();
      expect(headers['X-Content-Type-Options']).toEqual(['nosniff']);
    });

    it('sets X-Frame-Options to DENY', () => {
      const headers = getResponseHeaders();
      expect(headers['X-Frame-Options']).toEqual(['DENY']);
    });

    it('sets X-XSS-Protection', () => {
      const headers = getResponseHeaders();
      expect(headers['X-XSS-Protection']).toEqual(['1; mode=block']);
    });

    it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
      const headers = getResponseHeaders();
      expect(headers['Referrer-Policy']).toEqual(['strict-origin-when-cross-origin']);
    });

    it('preserves existing response headers', () => {
      const headers = getResponseHeaders({
        responseHeaders: { 'X-Custom': ['value'] },
      });
      expect(headers['X-Custom']).toEqual(['value']);
      expect(headers['Content-Security-Policy']).toBeDefined();
    });
  });

  describe('CSP common directives', () => {
    beforeEach(() => {
      setupSecurityHeaders(false);
    });

    it("sets default-src to 'self'", () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      expect(csp).toMatch(/default-src 'self'/);
    });

    it("sets object-src to 'none'", () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      expect(csp).toContain("object-src 'none'");
    });

    it("sets base-uri to 'self'", () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      expect(csp).toContain("base-uri 'self'");
    });

    it("sets form-action to 'self'", () => {
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      expect(csp).toContain("form-action 'self'");
    });
  });

  describe('connect-src dynamic PocketBase URLs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses default localhost:8090 when appConfig is null', () => {
      mockAppConfig = null;
      setupSecurityHeaders(false);
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:8090');
      expect(connectSrc).toContain('ws://127.0.0.1:8090');
    });

    it('uses configured port in server mode', () => {
      mockAppConfig = {
        load: () => ({ mode: 'server', port: 9999 }),
      };
      setupSecurityHeaders(false);
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:9999');
      expect(connectSrc).toContain('ws://127.0.0.1:9999');
    });

    it('uses serverUrl in client mode with http', () => {
      const httpUrl = 'http://myserver.local:8090'; // eslint-disable-line sonarjs/no-clear-text-protocols
      mockAppConfig = {
        load: () => ({ mode: 'client', serverUrl: httpUrl }),
      };
      setupSecurityHeaders(false);
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';
      expect(connectSrc).toContain(httpUrl);
      expect(connectSrc).toContain('ws://myserver.local:8090');
    });

    it('uses serverUrl in client mode with https', () => {
      mockAppConfig = {
        load: () => ({ mode: 'client', serverUrl: 'https://secure.example.com' }),
      };
      setupSecurityHeaders(false);
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';
      expect(connectSrc).toContain('https://secure.example.com');
      expect(connectSrc).toContain('wss://secure.example.com');
    });

    it('falls back to defaults when config load returns undefined', () => {
      mockAppConfig = {
        load: () => undefined,
      };
      setupSecurityHeaders(false);
      const headers = getResponseHeaders();
      const csp = headers['Content-Security-Policy']![0];
      const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:8090');
    });
  });
});
