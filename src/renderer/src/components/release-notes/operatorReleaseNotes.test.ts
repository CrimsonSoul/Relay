import { describe, expect, it } from 'vitest';
import { operatorReleaseNotes } from './operatorReleaseNotes';

describe('operatorReleaseNotes', () => {
  it('keeps user-facing changes in plain words and drops internal noise', () => {
    const body = [
      "## What's Changed",
      '* feat(sdp): fewer SDP requests, on-time SLA alerts [skip release] by @someone in https://github.com/o/r/pull/308',
      '* chore(release): publish the changes by @someone in https://github.com/o/r/pull/309',
      '* fix: keep the queue in view by @someone in https://github.com/o/r/pull/310',
      '',
      '**Full Changelog**: https://github.com/o/r/compare/v1.15.0...v1.16.0',
    ].join('\n');
    expect(operatorReleaseNotes(body)).toBe(
      [
        "## What's Changed",
        '* Fewer SDP requests, on-time SLA alerts',
        '* Keep the queue in view',
      ].join('\n'),
    );
  });

  it('names a release with only internal commits', () => {
    expect(operatorReleaseNotes('* ci: speed up the build by @a in https://x.test/pull/1')).toBe(
      'Maintenance release with no visible changes.',
    );
  });

  it('leaves hand-written notes alone', () => {
    expect(operatorReleaseNotes('Relay now remembers your filters.')).toBe(
      'Relay now remembers your filters.',
    );
  });
});
