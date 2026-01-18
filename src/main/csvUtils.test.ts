import { describe, it, expect } from 'vitest';
import { validateEncoding, sanitizeField, desanitizeField, sanitizeCsvContent } from './csvUtils';

describe('csvUtils validation', () => {
  describe('validateEncoding', () => {
    it('accepts valid UTF-8 content', () => {
      const validContent = 'Name,Email,Phone\nJohn Doe,john@example.com,555-1234';
      expect(validateEncoding(validContent)).toBe(true);
    });

    it('rejects content with null bytes', () => {
      const invalidContent = 'Name,Email\x00,Phone\nJohn,john@example.com,555';
      expect(validateEncoding(invalidContent)).toBe(false);
    });

    it('rejects content with Unicode replacement character', () => {
      const invalidContent = 'Name,Email,Phone\nJohn\uFFFD,john@example.com,555';
      expect(validateEncoding(invalidContent)).toBe(false);
    });

    it('rejects content with private use area characters', () => {
      const invalidContent = 'Name,Email,Phone\nJohn\uE000,john@example.com,555';
      expect(validateEncoding(invalidContent)).toBe(false);
    });

    it('accepts content with common Unicode characters', () => {
      const validContent = 'Name,Email,Phone\nJuan García,juan@example.com,555-1234';
      expect(validateEncoding(validContent)).toBe(true);
    });
  });

  describe('sanitizeField', () => {
    it('returns empty string for null/undefined', () => {
      expect(sanitizeField(null)).toBe('');
      expect(sanitizeField(undefined)).toBe('');
    });

    it('escapes formula injection characters', () => {
      expect(sanitizeField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeField('+123')).toBe("'+123");
      expect(sanitizeField('-123')).toBe("'-123");
      expect(sanitizeField('@username')).toBe("'@username");
    });

    it('escapes DDE attack patterns', () => {
      expect(sanitizeField('DDE ("notepad")')).toBe("'DDE (\"notepad\")");
      expect(sanitizeField('@SUM(1+1)')).toBe("'@SUM(1+1)");
      expect(sanitizeField('cmd |calc')).toBe("'cmd |calc");
    });

    it('removes control characters', () => {
      const withControl = 'test\x00\x01\x02data';
      expect(sanitizeField(withControl)).toBe('testdata');
    });

    it('normalizes line endings', () => {
      expect(sanitizeField('line1\r\nline2')).toBe('line1 line2');
      expect(sanitizeField('line1\nline2')).toBe('line1 line2');
      expect(sanitizeField('line1\rline2')).toBe('line1 line2');
    });

    it('preserves safe content unchanged', () => {
      expect(sanitizeField('John Doe')).toBe('John Doe');
      expect(sanitizeField('john@example.com')).toBe('john@example.com');
      expect(sanitizeField('555-1234')).toBe('555-1234');
    });
  });

  describe('desanitizeField', () => {
    it('removes escape quote for formula characters', () => {
      expect(desanitizeField("'=SUM(A1)")).toBe('=SUM(A1)');
      expect(desanitizeField("'+123")).toBe('+123');
      expect(desanitizeField("'-123")).toBe('-123');
      expect(desanitizeField("'@user")).toBe('@user');
    });

    it('preserves content without escape quote', () => {
      expect(desanitizeField('John Doe')).toBe('John Doe');
      expect(desanitizeField("'normal text")).toBe("'normal text");
    });

    it('handles null/undefined', () => {
      expect(desanitizeField(null)).toBe('');
      expect(desanitizeField(undefined)).toBe('');
    });
  });

  describe('sanitizeCsvContent', () => {
    it('strips BOM character', () => {
      const withBom = '\uFEFFName,Email\nJohn,john@example.com';
      expect(sanitizeCsvContent(withBom)).toBe('Name,Email\nJohn,john@example.com');
    });

    it('normalizes line endings to LF', () => {
      const windowsEndings = 'Name,Email\r\nJohn,john@example.com\r\nJane,jane@example.com';
      expect(sanitizeCsvContent(windowsEndings)).toBe('Name,Email\nJohn,john@example.com\nJane,jane@example.com');
    });

    it('removes null bytes', () => {
      const withNulls = 'Name,Email\x00\nJohn,john@example.com';
      expect(sanitizeCsvContent(withNulls)).toBe('Name,Email\nJohn,john@example.com');
    });

    it('handles combined issues', () => {
      const messy = '\uFEFFName,Email\r\n\x00John,john@example.com';
      expect(sanitizeCsvContent(messy)).toBe('Name,Email\nJohn,john@example.com');
    });
  });
});
