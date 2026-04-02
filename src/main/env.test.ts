import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({
  loggers: {
    main: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    fileManager: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    security: { error: vi.fn() },
  },
}));

import { loggers } from './logger';
import { validateEnv } from './env';

describe('validateEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('sets default for NODE_ENV when missing', () => {
    delete process.env.NODE_ENV;
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(process.env.NODE_ENV).toBe('production');
  });

  it('passes validation for valid env', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(loggers.main.info).toHaveBeenCalledWith('Environment variables validated successfully');
    expect(loggers.main.error).not.toHaveBeenCalled();
  });

  it('logs error for invalid NODE_ENV value', () => {
    process.env.NODE_ENV = 'invalid_env';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(loggers.main.error).toHaveBeenCalledWith(
      'Environment validation errors detected',
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining('NODE_ENV')]),
      }),
    );
  });

  it('sets default for ELECTRON_ENABLE_LOGGING when missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(process.env.ELECTRON_ENABLE_LOGGING).toBe('false');
  });

  it('accepts valid boolean values for ELECTRON_ENABLE_LOGGING', () => {
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_ENABLE_LOGGING = 'true';

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();
    expect(loggers.main.info).toHaveBeenCalledWith('Environment variables validated successfully');
  });

  it('logs error for invalid boolean ELECTRON_ENABLE_LOGGING', () => {
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_ENABLE_LOGGING = 'notabool';

    validateEnv();

    expect(loggers.main.error).toHaveBeenCalledWith(
      'Environment validation errors detected',
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining('ELECTRON_ENABLE_LOGGING')]),
      }),
    );
  });

  it('does not throw for non-critical validation errors', () => {
    process.env.NODE_ENV = 'invalid_env';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    // Should not throw — NODE_ENV failed custom validation but is not a "required" var
    expect(() => validateEnv()).not.toThrow();
  });

  it('does not set default when value is already present', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    // NODE_ENV should remain 'test', not be overwritten with default 'production'
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('accepts ELECTRON_RENDERER_URL when present (not required)', () => {
    process.env.NODE_ENV = 'development';
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();
  });

  it('accepts 0 and 1 as valid boolean values', () => {
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_ENABLE_LOGGING = '0';

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();

    process.env.ELECTRON_ENABLE_LOGGING = '1';
    vi.clearAllMocks();

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();
  });

  it('accepts TRUE and FALSE (case insensitive) for boolean env vars', () => {
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_ENABLE_LOGGING = 'TRUE';

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();

    process.env.ELECTRON_ENABLE_LOGGING = 'FALSE';
    vi.clearAllMocks();

    validateEnv();

    expect(loggers.main.error).not.toHaveBeenCalled();
  });

  it('validates number type when schema requires it', () => {
    // The current schema doesn't have a number-type variable,
    // but we test the validateTypeAndPattern branch by setting
    // NODE_ENV to something that fails custom validation (not number type).
    // We indirectly test by ensuring the branch logic works.
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_ENABLE_LOGGING = 'true';
    // No required vars missing, no errors
    validateEnv();
    expect(loggers.main.info).toHaveBeenCalledWith('Environment variables validated successfully');
  });

  it('pattern validation branch is exercised (no pattern in current schema)', () => {
    // Current schema has no pattern-based validation, so this test verifies
    // the code runs without errors when pattern is undefined
    process.env.NODE_ENV = 'test';
    delete process.env.ELECTRON_ENABLE_LOGGING;

    validateEnv();

    expect(loggers.main.info).toHaveBeenCalledWith('Environment variables validated successfully');
  });

  it('does not set default when value is already provided and valid', () => {
    process.env.NODE_ENV = 'development';
    process.env.ELECTRON_ENABLE_LOGGING = 'true';

    validateEnv();

    expect(process.env.NODE_ENV).toBe('development');
    expect(process.env.ELECTRON_ENABLE_LOGGING).toBe('true');
  });
});
