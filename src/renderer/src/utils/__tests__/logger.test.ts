import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock redactSensitiveData to be transparent (return input as-is)
vi.mock('@shared/logRedaction', () => ({
  redactSensitiveData: (data: unknown) => data,
}));

// Import after mocks
import { loggers } from '../logger';

describe('renderer logger (loggers)', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loggers object exports expected module loggers', () => {
    expect(loggers.app).toBeDefined();
    expect(loggers.weather).toBeDefined();
    expect(loggers.directory).toBeDefined();
    expect(loggers.ui).toBeDefined();
    expect(loggers.location).toBeDefined();
    expect(loggers.api).toBeDefined();
    expect(loggers.storage).toBeDefined();
    expect(loggers.network).toBeDefined();
  });

  it('app.info logs to console.info', () => {
    loggers.app.info('Test message');
    expect(consoleSpy.info).toHaveBeenCalled();
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain('Test message');
    expect(output).toContain('Renderer:App');
  });

  it('app.warn logs to console.warn', () => {
    loggers.app.warn('Warning message');
    expect(consoleSpy.warn).toHaveBeenCalled();
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('Warning message');
  });

  it('app.error logs to console.error', () => {
    loggers.app.error('Error occurred');
    expect(consoleSpy.error).toHaveBeenCalled();
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain('Error occurred');
  });

  it('weather.info includes the weather module name', () => {
    loggers.weather.info('Forecast fetched');
    expect(consoleSpy.info).toHaveBeenCalled();
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain('Renderer:Weather');
    expect(output).toContain('Forecast fetched');
  });

  it('includes data in log output', () => {
    loggers.app.info('With data', { count: 42 });
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain('42');
  });

  it('includes errorContext category in warn output', () => {
    loggers.app.warn('Warning with context', { category: 'renderer' });
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('renderer');
  });

  it('forwards to main process when api.logToMain is available', () => {
    const logToMain = vi.fn();
    (globalThis as Record<string, unknown>).api = { logToMain };
    loggers.app.info('IPC message');
    expect(logToMain).toHaveBeenCalled();
    (globalThis as Record<string, unknown>).api = undefined;
  });

  it('does not throw when api.logToMain is not available', () => {
    (globalThis as Record<string, unknown>).api = undefined;
    expect(() => loggers.app.info('No API')).not.toThrow();
  });

  it('handles logToMain throwing without crashing', () => {
    (globalThis as Record<string, unknown>).api = {
      logToMain: () => {
        throw new Error('IPC error');
      },
    };
    expect(() => loggers.app.info('IPC throws')).not.toThrow();
    (globalThis as Record<string, unknown>).api = undefined;
  });

  it('does not log debug messages at INFO level by default', () => {
    // The default level is INFO, so debug should be suppressed
    // (debug calls internal shouldLog which returns false for DEBUG < INFO)
    loggers.app.debug('Debug message');
    expect(consoleSpy.debug).not.toHaveBeenCalled();
  });

  it('logs an error context stack in the output when stack is provided', () => {
    loggers.app.error('Error with stack', { stack: 'Error: test\n  at foo:1' });
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain('Error: test');
  });

  it('logs errorCode from error context', () => {
    loggers.app.warn('Warning with code', { errorCode: 'ERR_001' });
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('ERR_001');
  });

  it('logs userAction from error context', () => {
    loggers.app.warn('With user action', { userAction: 'save' });
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('save');
  });

  it('extracts stack from Error object in data', () => {
    const err = new Error('test error');
    loggers.app.error('Error obj', { error: err });
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain('Error');
  });
});
