import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSecureOrigin,
  isTrustedGeolocationOrigin,
  isTrustedWebviewUrl,
  registerTrustedWebviewOrigin,
  clearTrustedRuntimeOrigins,
} from './securityPolicy';

describe('securityPolicy', () => {
  beforeEach(() => {
    clearTrustedRuntimeOrigins();
  });

  it('allows exact trusted origins', () => {
    expect(isTrustedWebviewUrl('https://chatgpt.com/')).toBe(true);
    expect(isTrustedWebviewUrl('https://www.rainviewer.com/weather')).toBe(true);
  });

  it('rejects prefix-based origin bypasses', () => {
    expect(isTrustedWebviewUrl('https://chatgpt.com.evil.tld')).toBe(false);
    expect(isTrustedWebviewUrl('https://chatgpt.com@evil.tld')).toBe(false);
  });

  it('rejects non-https origins for geolocation trust', () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(isTrustedGeolocationOrigin('http://www.rainviewer.com')).toBe(false);
    expect(isTrustedGeolocationOrigin('file:///index.html')).toBe(false);
  });

  it('normalizes https URLs to origins', () => {
    expect(getSecureOrigin('https://example.com/path?q=1')).toBe('https://example.com');
  });

  describe('registerTrustedWebviewOrigin', () => {
    it('registers a valid https URL as trusted at runtime', () => {
      registerTrustedWebviewOrigin('https://custom-radar.example.com/path');
      expect(isTrustedWebviewUrl('https://custom-radar.example.com/other')).toBe(true);
    });

    it('ignores null input', () => {
      registerTrustedWebviewOrigin(null);
      // Should not throw or add anything
      expect(isTrustedWebviewUrl(null)).toBe(false);
    });

    it('ignores undefined input', () => {
      registerTrustedWebviewOrigin(undefined);
      expect(isTrustedWebviewUrl(undefined)).toBe(false);
    });

    it('ignores non-https URLs', () => {
      registerTrustedWebviewOrigin('http://insecure.example.com');
      expect(isTrustedWebviewUrl('http://insecure.example.com')).toBe(false);
    });

    it('ignores invalid URLs', () => {
      registerTrustedWebviewOrigin('not a url at all');
      expect(isTrustedWebviewUrl('not a url at all')).toBe(false);
    });

    it('clears runtime origins', () => {
      registerTrustedWebviewOrigin('https://custom.example.com');
      expect(isTrustedWebviewUrl('https://custom.example.com/')).toBe(true);

      clearTrustedRuntimeOrigins();
      expect(isTrustedWebviewUrl('https://custom.example.com/')).toBe(false);
    });
  });

  describe('getSecureOrigin edge cases', () => {
    it('returns null for null input', () => {
      expect(getSecureOrigin(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getSecureOrigin(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getSecureOrigin('')).toBeNull();
    });

    it('returns null for non-https protocol', () => {
      expect(getSecureOrigin('ftp://example.com')).toBeNull();
    });

    it('returns null for invalid URL string', () => {
      expect(getSecureOrigin(':::invalid')).toBeNull();
    });

    it('returns origin for https URL with port', () => {
      expect(getSecureOrigin('https://example.com:8443/path')).toBe('https://example.com:8443');
    });
  });

  describe('isTrustedWebviewUrl edge cases', () => {
    it('returns false for null', () => {
      expect(isTrustedWebviewUrl(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTrustedWebviewUrl(undefined)).toBe(false);
    });

    it('returns false for non-https URL of a trusted domain', () => {
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      expect(isTrustedWebviewUrl('http://chatgpt.com/')).toBe(false);
    });
  });

  describe('isTrustedGeolocationOrigin edge cases', () => {
    it('returns false for null', () => {
      expect(isTrustedGeolocationOrigin(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTrustedGeolocationOrigin(undefined)).toBe(false);
    });

    it('returns true for allowed geolocation origin with path', () => {
      expect(isTrustedGeolocationOrigin('https://www.rainviewer.com/map')).toBe(true);
    });

    it('returns false for non-allowed https origin', () => {
      expect(isTrustedGeolocationOrigin('https://example.com')).toBe(false);
    });
  });
});
