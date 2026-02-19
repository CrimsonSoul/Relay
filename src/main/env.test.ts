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
});
