import { describe, it, expect, vi } from 'vitest';
import { ModuleLogger, LogLevel } from './logging';
import type { ILogger } from './logging';

describe('ModuleLogger', () => {
  const makeParent = (): ILogger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    startTimer: vi.fn(() => vi.fn()),
  });

  it('forwards debug calls with module name', () => {
    const parent = makeParent();
    const logger = new ModuleLogger(parent, 'TestModule');
    logger.debug('hello debug', { value: 1 });
    expect(parent.debug).toHaveBeenCalledWith('TestModule', 'hello debug', { value: 1 });
  });

  it('forwards info calls with module name', () => {
    const parent = makeParent();
    const logger = new ModuleLogger(parent, 'TestModule');
    logger.info('hello info');
    expect(parent.info).toHaveBeenCalledWith('TestModule', 'hello info', undefined);
  });

  it('forwards warn calls with module name', () => {
    const parent = makeParent();
    const logger = new ModuleLogger(parent, 'TestModule');
    logger.warn('a warning', { value: 'x' });
    expect(parent.warn).toHaveBeenCalledWith('TestModule', 'a warning', { value: 'x' });
  });

  it('forwards error calls with module name', () => {
    const parent = makeParent();
    const logger = new ModuleLogger(parent, 'TestModule');
    logger.error('an error');
    expect(parent.error).toHaveBeenCalledWith('TestModule', 'an error', undefined);
  });

  it('forwards fatal calls with module name', () => {
    const parent = makeParent();
    const logger = new ModuleLogger(parent, 'TestModule');
    logger.fatal('fatal message', { code: 500 });
    expect(parent.fatal).toHaveBeenCalledWith('TestModule', 'fatal message', { code: 500 });
  });

  it('startTimer delegates to parent with module name and returns the timer fn', () => {
    const mockTimer = vi.fn();
    const parent = makeParent();
    (parent.startTimer as ReturnType<typeof vi.fn>).mockReturnValue(mockTimer);

    const logger = new ModuleLogger(parent, 'TestModule');
    const stop = logger.startTimer('my-op');

    expect(parent.startTimer).toHaveBeenCalledWith('TestModule', 'my-op');
    expect(stop).toBe(mockTimer);
  });
});

describe('LogLevel enum', () => {
  it('has correct ordering', () => {
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
    expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
    expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.FATAL);
    expect(LogLevel.FATAL).toBeLessThan(LogLevel.NONE);
  });
});
