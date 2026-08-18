import { describe, expect, it } from 'vitest';
import {
  buildDynatraceProblemUrl,
  getDynatraceApiTokenError,
  getDynatraceCustomDqlMatcherError,
  getDynatraceEnvironmentUrlError,
  normalizeDynatraceCustomDqlMatcher,
  normalizeDynatraceEnvironmentUrl,
  normalizeDynatraceProblemScopeTestResult,
  type DynatraceProblemNoteRecord,
} from './dynatraceProblems';

it('allows new problem notes to omit an author snapshot', () => {
  const note: DynatraceProblemNoteRecord = {
    id: 'note-unattributed',
    problemId: 'problem-1',
    note: 'Mitigation is in progress.',
    created: '2026-07-17T18:00:00.000Z',
  };

  expect(note).not.toHaveProperty('author');
});

describe('Dynatrace Problems validation', () => {
  it('accepts and normalizes a Dynatrace SaaS environment origin', () => {
    expect(getDynatraceEnvironmentUrlError('https://abc123.apps.dynatrace.com')).toBeNull();
    expect(normalizeDynatraceEnvironmentUrl(' https://abc123.apps.dynatrace.com/ ')).toBe(
      'https://abc123.apps.dynatrace.com',
    );
    expect(normalizeDynatraceEnvironmentUrl('https://abc123.live.dynatrace.com')).toBe(
      'https://abc123.apps.dynatrace.com',
    );
  });

  it('rejects insecure, credentialed, public, and path-bearing URLs', () => {
    const insecureUrl = new URL('https://abc123.apps.dynatrace.com');
    insecureUrl.protocol = 'http:';
    for (const value of [
      insecureUrl.origin,
      'https://user:pass@abc123.apps.dynatrace.com',
      'https://example.com',
      'https://abc123.apps.dynatrace.com/api/v2/problems',
      'https://abc123.apps.dynatrace.com/?token=secret',
    ]) {
      expect(getDynatraceEnvironmentUrlError(value)).not.toBeNull();
      expect(normalizeDynatraceEnvironmentUrl(value)).toBe('');
    }
  });

  it('rejects blank, whitespace-bearing, and oversized platform tokens', () => {
    expect(getDynatraceApiTokenError('')).toMatch(/enter/i);
    expect(getDynatraceApiTokenError('token with spaces')).toMatch(/whitespace/i);
    expect(getDynatraceApiTokenError('x'.repeat(4097))).toMatch(/too long/i);
    expect(getDynatraceApiTokenError('dt0s16.example-token')).toBeNull();
  });

  it('accepts a multiline workflow-style matcher while preserving quoted pipeline characters', () => {
    const matcher = `
      (
        matchesValue(entity_tags, "teams:network")
        or matchesPhrase(event.name, "Packet loss on")
        or matchesValue(event.name, "WAN | Core")
        or matchesValue(labels.alerting_profile, "*Alerts for NOC")
      )
      and maintenance.is_under_maintenance == false
      and dt.davis.mute.status == "NOT_MUTED"
    `;

    expect(getDynatraceCustomDqlMatcherError(matcher)).toBeNull();
    expect(normalizeDynatraceCustomDqlMatcher(`\r\n${matcher}\r\n`)).toBe(
      matcher.trim().replaceAll('\r\n', '\n'),
    );
  });

  it.each([
    ['a complete pipeline', 'matchesValue(event.name, "*") | limit 1', /matcher expression/i],
    ['a fetch command', 'fetch dt.davis.problems, from:-2h', /matcher expression/i],
    ['a line comment', 'matchesValue(event.name, "UPS*") // ignore', /comments/i],
    ['a block comment', 'matchesValue(event.name, "UPS*") /* ignore */', /comments/i],
    [
      'transition-dependent filtering',
      'not matchesValue(event.status_transition, "UPDATED")',
      /status_transition/i,
    ],
    ['an unclosed string', 'matchesValue(event.name, "UPS*)', /quoted string/i],
    ['a control character', 'matchesValue(event.name, "UPS")\u0000', /control/i],
    ['an oversized matcher', 'x'.repeat(16_001), /too long/i],
  ])('rejects %s', (_caseName, matcher, expectedError) => {
    expect(getDynatraceCustomDqlMatcherError(matcher)).toMatch(expectedError);
  });

  it('allows a blank matcher to clear custom DQL scope', () => {
    expect(getDynatraceCustomDqlMatcherError('  \r\n  ')).toBeNull();
    expect(normalizeDynatraceCustomDqlMatcher('  \r\n  ')).toBe('');
  });

  it('normalizes only bounded custom-scope test results', () => {
    expect(normalizeDynatraceProblemScopeTestResult({ valid: true, problemCount: 0 })).toEqual({
      valid: true,
      problemCount: 0,
    });
    expect(
      normalizeDynatraceProblemScopeTestResult({
        valid: false,
        error: 'Dynatrace rejected the matcher syntax.',
      }),
    ).toEqual({ valid: false, error: 'Dynatrace rejected the matcher syntax.' });
    expect(normalizeDynatraceProblemScopeTestResult({ valid: true, problemCount: -1 })).toBeNull();
    expect(
      normalizeDynatraceProblemScopeTestResult({ valid: false, error: 'x'.repeat(513) }),
    ).toBeNull();
  });
});

describe('Dynatrace problem links', () => {
  it('builds the official Platform Problems route without source query or hash values', () => {
    expect(
      buildDynatraceProblemUrl(
        'https://abc.live.dynatrace.com/?source=relay#old',
        '2251993042228772816_1783622735060V2',
      ),
    ).toBe(
      'https://abc.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/' +
        '2251993042228772816_1783622735060V2',
    );
  });

  it('encodes the trimmed problem ID as a single path segment', () => {
    expect(
      buildDynatraceProblemUrl('https://abc.apps.dynatrace.com', ' problem/with spaces? '),
    ).toBe(
      'https://abc.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/' +
        'problem%2Fwith%20spaces%3F',
    );
  });

  it('rejects untrusted origins and blank or oversized problem IDs', () => {
    expect(buildDynatraceProblemUrl('https://example.com', 'P-1')).toBeNull();
    expect(buildDynatraceProblemUrl('https://abc.apps.dynatrace.com', '   ')).toBeNull();
    expect(buildDynatraceProblemUrl('https://abc.apps.dynatrace.com', 'x'.repeat(513))).toBeNull();
  });
});
