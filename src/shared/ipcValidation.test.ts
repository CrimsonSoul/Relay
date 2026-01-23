import { describe, it, expect } from 'vitest';
import { SearchQuerySchema, LogEntrySchema } from './ipcValidation';

describe('SearchQuerySchema', () => {
  it('accepts valid queries', () => {
    expect(SearchQuerySchema.safeParse('New York').success).toBe(true);
    expect(SearchQuerySchema.safeParse('London, UK').success).toBe(true);
    expect(SearchQuerySchema.safeParse('12345').success).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(SearchQuerySchema.safeParse('').success).toBe(false);
  });

  it('rejects extremely long strings', () => {
    expect(SearchQuerySchema.safeParse('a'.repeat(201)).success).toBe(false);
  });

  it('rejects queries with forbidden characters', () => {
    expect(SearchQuerySchema.safeParse('<script>').success).toBe(false);
    expect(SearchQuerySchema.safeParse('{json: true}').success).toBe(false);
  });
});

describe('LogEntrySchema', () => {
  it('accepts valid log entries', () => {
    const valid = {
      level: 'INFO',
      module: 'App',
      message: 'Test message',
      data: { key: 'value' }
    };
    expect(LogEntrySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid log levels', () => {
    expect(LogEntrySchema.safeParse({ level: 'VERBOSE', module: 'App', message: 'm' }).success).toBe(false);
  });

  it('rejects messages over 5000 chars', () => {
    expect(LogEntrySchema.safeParse({ level: 'INFO', module: 'App', message: 'a'.repeat(5001) }).success).toBe(false);
  });

  it('rejects modules over 100 chars', () => {
    expect(LogEntrySchema.safeParse({ level: 'INFO', module: 'a'.repeat(101), message: 'm' }).success).toBe(false);
  });
});
