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

/** Helper: invoke the handler and return the single Content-Security-Policy header value */
function getCsp(details: { responseHeaders?: Record<string, string[]> } = {}): string {
  const [csp] = getResponseHeaders(details)['Content-Security-Policy'] ?? [];
  if (csp === undefined) throw new Error('No Content-Security-Policy response header was set');
  return csp;
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
      const csp = getCsp();
      expect(csp).not.toContain("'unsafe-eval'");
    });

    it('does not include unsafe-inline in script-src', () => {
      const csp = getCsp();
      // Extract the script-src directive specifically
      const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('includes a sha256 hash for script-src in production', () => {
      const csp = getCsp();
      const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
    });
  });

  describe('CSP in development mode (isDev=true)', () => {
    beforeEach(() => {
      setupSecurityHeaders(true);
    });

    it('includes unsafe-eval in script-src for HMR', () => {
      const csp = getCsp();
      const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(scriptSrc).toContain("'unsafe-eval'");
    });

    it('includes unsafe-inline in script-src for dev', () => {
      const csp = getCsp();
      const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? '';
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
      const csp = getCsp();
      expect(csp).toMatch(/default-src 'self'/);
    });

    it.each(["object-src 'none'", "base-uri 'self'", "form-action 'self'"])(
      'sets the %s CSP directive',
      (directive) => {
        const csp = getCsp();
        expect(csp).toContain(directive);
      },
    );
  });

  describe('connect-src dynamic PocketBase URLs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses default localhost:8090 when appConfig is null', () => {
      mockAppConfig = null;
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:8090');
      expect(connectSrc).toContain('ws://127.0.0.1:8090');
    });

    it('uses configured port in server mode', () => {
      mockAppConfig = {
        load: () => ({ mode: 'server', port: 9999 }),
      };
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:9999');
      expect(connectSrc).toContain('ws://127.0.0.1:9999');
    });

    it('uses serverUrl in client mode with http', () => {
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Deliberate trusted-LAN HTTP fixture verifies the CSP derives matching HTTP and WS origins.
      const httpUrl = 'http://myserver.local:8090';
      mockAppConfig = {
        load: () => ({ mode: 'client', serverUrl: httpUrl }),
      };
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toContain(httpUrl);
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- The expected clear-text WS origin is the behavior under test for a trusted-LAN HTTP server.
      expect(connectSrc).toContain('ws://myserver.local:8090');
    });

    it('uses serverUrl in client mode with https', () => {
      mockAppConfig = {
        load: () => ({ mode: 'client', serverUrl: 'https://secure.example.com' }),
      };
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toContain('https://secure.example.com');
      expect(connectSrc).toContain('wss://secure.example.com');
    });

    it('derives client connect-src from parsed origins instead of raw serverUrl text', () => {
      mockAppConfig = {
        load: () => ({
          mode: 'client',
          serverUrl: "https://secure.example.com/path; script-src 'unsafe-inline'",
        }),
      };
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toBe(
        "connect-src 'self' https://secure.example.com wss://secure.example.com",
      );
    });

    it('falls back to defaults when config load returns undefined', () => {
      mockAppConfig = {
        load: () => undefined,
      };
      setupSecurityHeaders(false);
      const csp = getCsp();
      const connectSrc = /connect-src[^;]*/.exec(csp)?.[0] ?? '';
      expect(connectSrc).toContain('http://127.0.0.1:8090');
    });
  });
});
