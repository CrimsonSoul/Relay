import { enhanceHtml } from '../alerts/enhanceEngine';

describe('enhanceHtml', () => {
  it('returns empty string for empty input', () => {
    expect(enhanceHtml('')).toBe('');
  });

  it('highlights time durations as deadline', () => {
    const result = enhanceHtml('Password expires in 60 days.');
    expect(result).toContain('data-hl="deadline"');
    expect(result).toContain('60 days');
  });

  it('highlights dates as deadline', () => {
    const result = enhanceHtml('Update before May 24, 2026.');
    expect(result).toContain('data-hl="deadline"');
    expect(result).toContain('May 24, 2026');
  });

  it('highlights UTC timestamps as deadline', () => {
    const result = enhanceHtml('Outage since 14:15 UTC.');
    expect(result).toContain('data-hl="deadline"');
  });

  it('highlights warning words', () => {
    const result = enhanceHtml('We are experiencing a complete outage.');
    expect(result).toContain('data-hl="warning"');
    expect(result).toContain('outage');
  });

  it('highlights success words', () => {
    const result = enhanceHtml('The issue has been fully resolved.');
    expect(result).toContain('data-hl="success"');
    expect(result).toContain('resolved');
  });

  it('highlights percentages as numbers', () => {
    const result = enhanceHtml('Error rate is 100%.');
    expect(result).toContain('data-hl="number"');
    expect(result).toContain('100%');
  });

  it('bolds action words', () => {
    const result = enhanceHtml('All employees must update their password.');
    expect(result).toContain('<b>must</b>');
  });

  it('bolds "do not" phrases', () => {
    const result = enhanceHtml('Do not share your password.');
    expect(result).toContain('<b>Do not</b>');
  });

  it('does not double-wrap existing data-hl spans', () => {
    const input = 'Deadline is <span data-hl="deadline">May 1</span> and expires in 30 days.';
    const result = enhanceHtml(input);
    // "May 1" should not be double-wrapped
    expect(result).not.toContain('data-hl="deadline"><span data-hl=');
    // "30 days" should be enhanced
    expect(result).toContain('30 days');
  });

  it('handles URLs', () => {
    const result = enhanceHtml('Visit password.company.com to reset.');
    expect(result).toContain('password.company.com');
  });

  it('highlights ext. numbers', () => {
    const result = enhanceHtml('Call ext. 4357 for help.');
    expect(result).toContain('data-hl="number"');
  });
});
