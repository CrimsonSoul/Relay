import { compactText } from '../alerts/compactEngine';

describe('compactText', () => {
  it('returns empty string for empty input', () => {
    expect(compactText('')).toBe('');
  });

  it('removes throat-clearing phrases', () => {
    expect(compactText('Please be advised that your password expires soon.')).toBe(
      'Your password expires soon.',
    );
  });

  it('removes "We wanted to make you aware that"', () => {
    expect(compactText('We wanted to make you aware that the server is down.')).toBe(
      'The server is down.',
    );
  });

  it('replaces "in order to" with "to"', () => {
    expect(compactText('Click the link in order to reset your password.')).toBe(
      'Click the link to reset your password.',
    );
  });

  it('replaces "approximately" with "~"', () => {
    expect(compactText('ETA is approximately 2 hours.')).toBe('ETA is ~2 hours.');
  });

  it('replaces "at this point in time" with "now"', () => {
    expect(compactText('At this point in time, the service is degraded.')).toBe(
      'Now, the service is degraded.',
    );
  });

  it('removes trailing update promises', () => {
    expect(
      compactText(
        'We are investigating. We will provide updates as more information becomes available.',
      ),
    ).toBe('We are investigating.');
  });

  it('removes "please don\'t hesitate to"', () => {
    expect(compactText("Please don't hesitate to contact IT.")).toBe('Contact IT.');
  });

  it('removes "We appreciate your patience and cooperation"', () => {
    const input = 'Service restored. We appreciate your patience and cooperation during this time.';
    expect(compactText(input)).toBe('Service restored.');
  });

  it('replaces "Failure to do so will result in" with "Otherwise:"', () => {
    expect(
      compactText('Update your password. Failure to do so will result in account lockout.'),
    ).toBe('Update your password. Otherwise: account lockout.');
  });

  it('applies multiple rules in one pass', () => {
    const input =
      'Please be advised that we are currently experiencing issues. We will provide updates as more information becomes available.';
    const result = compactText(input);
    // "Please be advised that" removed, "currently" removed, trailing update promise removed
    expect(result).toBe('We are experiencing issues.');
  });

  it('handles mixed case in patterns', () => {
    expect(compactText('PLEASE BE ADVISED THAT the server is down.')).toBe('The server is down.');
  });

  it('cleans up extra whitespace after removals', () => {
    const input = 'Please be advised that  your password  will expire.';
    expect(compactText(input)).not.toContain('  ');
  });
});
