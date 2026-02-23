import { describe, expect, it } from 'vitest';
import { getSecureOrigin, isTrustedGeolocationOrigin, isTrustedWebviewUrl } from './securityPolicy';

describe('securityPolicy', () => {
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
});
