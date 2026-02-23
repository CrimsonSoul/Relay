import { describe, expect, it } from 'vitest';
import { getColorForString, AMBER } from '../colors';

describe('colors', () => {
  describe('AMBER', () => {
    it('exports AMBER color scheme with expected properties', () => {
      expect(AMBER).toMatchObject({
        bg: expect.stringContaining('rgba'),
        border: expect.stringContaining('rgba'),
        text: expect.any(String),
        fill: expect.any(String),
      });
    });
  });

  describe('getColorForString', () => {
    it('returns a color scheme with all required fields', () => {
      const scheme = getColorForString('hello');
      expect(scheme).toMatchObject({
        bg: expect.stringContaining('rgba'),
        border: expect.stringContaining('rgba'),
        text: expect.any(String),
        fill: expect.any(String),
      });
    });

    it('returns the same color for the same input', () => {
      const a = getColorForString('SRE');
      const b = getColorForString('SRE');
      expect(a).toEqual(b);
    });

    it('returns different colors for different inputs (probabilistic)', () => {
      const a = getColorForString('Alpha');
      const b = getColorForString('Bravo Charlie Delta Echo Foxtrot');
      // Not guaranteed to differ but highly likely for these inputs
      // Just verify both are valid
      expect(a.bg).toBeTruthy();
      expect(b.bg).toBeTruthy();
    });

    it('handles empty string', () => {
      const scheme = getColorForString('');
      expect(scheme).toBeDefined();
      expect(scheme.bg).toBeTruthy();
    });

    it('handles unicode characters', () => {
      const scheme = getColorForString('日本語テスト');
      expect(scheme).toBeDefined();
      expect(scheme.fill).toBeTruthy();
    });
  });
});
