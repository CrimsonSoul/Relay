import { describe, expect, it } from 'vitest';
import {
  classifyDynatraceNavigation,
  getDynatraceStartUrlError,
  isDynatraceAuthUrl,
} from './dynatrace';

describe('Dynatrace URL policy', () => {
  it('accepts HTTPS Dynatrace dashboard start URLs', () => {
    expect(
      getDynatraceStartUrlError(
        'https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard',
      ),
    ).toBeNull();
    expect(getDynatraceStartUrlError('https://apps.dynatrace.com/dashboard/abc')).toBeNull();
  });

  it('rejects non-Dynatrace or non-HTTPS start URLs', () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(getDynatraceStartUrlError('http://abc12345.live.dynatrace.com/dashboard')).toBe(
      'Dynatrace dashboard URLs must use HTTPS.',
    );
    expect(getDynatraceStartUrlError('https://example.com/dashboard')).toBe(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
    expect(getDynatraceStartUrlError('not a url')).toBe('Enter a valid URL.');
  });

  it('allows Microsoft SSO only as navigation, not as a start URL', () => {
    expect(
      getDynatraceStartUrlError('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    ).toBe('Enter a Dynatrace URL under dynatrace.com.');
    expect(
      classifyDynatraceNavigation('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    ).toBe('microsoft-auth');
  });

  it('blocks unknown navigation targets and unsafe protocols', () => {
    expect(classifyDynatraceNavigation('https://evil.example/phish')).toBe('blocked');
    expect(classifyDynatraceNavigation('javascript:alert(1)')).toBe('blocked');
    expect(classifyDynatraceNavigation('file:///etc/passwd')).toBe('blocked');
  });

  it('identifies Dynatrace sign-in routes as auth state', () => {
    expect(isDynatraceAuthUrl('https://abc12345.live.dynatrace.com/signin')).toBe(true);
    expect(isDynatraceAuthUrl('https://abc12345.live.dynatrace.com/ui/login')).toBe(true);
    expect(
      isDynatraceAuthUrl(
        'https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard',
      ),
    ).toBe(false);
  });
});
