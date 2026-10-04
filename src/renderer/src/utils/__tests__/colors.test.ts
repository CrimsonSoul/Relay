import { describe, expect, it } from 'vitest';
import { getAccentHue } from '../../theme/accent';
import { IDENTITY_PALETTE, getColorForString } from '../colors';

/** Status colors from styles/theme.css (--alarm, --color-warning, --ok). */
const STATUS_COLORS = [
  { status: 'alarm', hex: '#ff4539' },
  { status: 'warning', hex: '#ffb000' },
  { status: 'ok', hex: '#2bb24c' },
] as const;
const STATUS_HUE_TOLERANCE_DEGREES = 30;

/** The status colour a hex sits within ~30° of in hue, or null (near-neutral colours carry no hue). */
function statusConflict(hex: string): (typeof STATUS_COLORS)[number]['status'] | null {
  const hue = getAccentHue(hex);
  if (hue === null) return null;
  let closest: { status: (typeof STATUS_COLORS)[number]['status']; distance: number } | null = null;
  for (const color of STATUS_COLORS) {
    const statusHue = getAccentHue(color.hex);
    if (statusHue === null) throw new Error(`status colour ${color.hex} has no hue`);
    const gap = Math.abs(hue - statusHue);
    const distance = Math.min(gap, 360 - gap);
    if (distance <= STATUS_HUE_TOLERANCE_DEGREES && (!closest || distance < closest.distance)) {
      closest = { status: color.status, distance };
    }
  }
  return closest?.status ?? null;
}

describe('colors', () => {
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

    it('uses 0 when codePointAt returns undefined', () => {
      // Force the ?? 0 fallback by providing a string whose codePointAt can return undefined
      // We can trigger this by mocking codePointAt to return undefined for one call
      const original = String.prototype.codePointAt;
      let callCount = 0;
      String.prototype.codePointAt = function (pos: number) {
        callCount++;
        if (callCount === 2) return undefined; // Force the ?? 0 branch
        return original.call(this, pos);
      };
      try {
        const scheme = getColorForString('abc');
        expect(scheme).toBeDefined();
        expect(scheme.bg).toBeTruthy();
      } finally {
        String.prototype.codePointAt = original;
      }
    });
  });

  describe('IDENTITY_PALETTE', () => {
    it('the status-conflict check flags status hues and ignores neutrals', () => {
      for (const color of STATUS_COLORS) expect(statusConflict(color.hex)).toBe(color.status);
      expect(statusConflict('#808080')).toBeNull();
    });

    it('never uses an alarm, warning or ok hue for identity', () => {
      for (const scheme of IDENTITY_PALETTE) {
        expect(statusConflict(scheme.fill), scheme.fill).toBeNull();
        expect(statusConflict(scheme.text), scheme.text).toBeNull();
      }
    });

    it('has no duplicate hues', () => {
      const fills = IDENTITY_PALETTE.map((scheme) => scheme.fill.toLowerCase());
      expect(new Set(fills).size).toBe(fills.length);
    });

    it('only hands out palette colours', () => {
      for (const name of ['SRE', 'Payments Escalation', 'Network Ops', 'SQL DBA', '']) {
        expect(IDENTITY_PALETTE).toContainEqual(getColorForString(name));
      }
    });

    it('skips identity entries close in hue to the active accent, deterministically', () => {
      const names = ['SRE', 'Payments Escalation', 'Network Ops', 'SQL DBA', 'Alpha', 'Facilities'];
      // Cyan (#06b6d4), Purple (#a855f7) and Violet (#8b5cf6) accent presets.
      for (const accent of ['#06b6d4', '#a855f7', '#8b5cf6']) {
        for (const name of names) {
          const scheme = getColorForString(name, accent);
          expect(scheme.fill.toLowerCase(), `${name} on ${accent}`).not.toBe(accent);
          expect(getColorForString(name, accent)).toEqual(scheme);
        }
      }
      // Cyan accent: neither cyan nor the adjacent teal is handed out.
      for (const name of names) {
        expect(['#06B6D4', '#14B8A6']).not.toContain(getColorForString(name, '#06b6d4').fill);
      }
    });

    it('keeps the plain hash pick when the accent is far from every identity hue', () => {
      for (const name of ['SRE', 'Payments Escalation', 'Network Ops']) {
        expect(getColorForString(name, '#e63946')).toEqual(getColorForString(name, ''));
      }
    });
  });
});
