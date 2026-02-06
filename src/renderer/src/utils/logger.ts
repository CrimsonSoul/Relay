/**
 * Renderer Process Logger
 *
 * Provides logging capabilities for the renderer process with automatic
 * forwarding to the main process logger for persistent storage.
 */

import { LogData } from '@shared/types';
import { LogLevel, ErrorCategory } from '@shared/logging';

interface ErrorContext {
  category?: ErrorCategory;
  errorCode?: string;
  stack?: string;
  userAction?: string;
  componentStack?: string;
  url?: string;
  correlationId?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: LogData;
  errorContext?: ErrorContext;
}

class RendererLogger {
  private level: LogLevel = LogLevel.INFO;
  private errorCount = 0;
  private warnCount = 0;
  private sessionStartTime = Date.now();

  constructor() {
    this.setupGlobalErrorHandlers();
  }

  private setupGlobalErrorHandlers(): void {
    // Catch global errors
    window.addEventListener('error', (event: ErrorEvent) => {
      // In production, don't include full stack traces for security
      const errorContext: Record<string, unknown> = {
        category: ErrorCategory.RENDERER,
      };

      if (import.meta.env.DEV) {
        errorContext.error = event.error;
        errorContext.stack = event.error?.stack;
        errorContext.filename = event.filename;
        errorContext.lineno = event.lineno;
        errorContext.colno = event.colno;
      }

      this.error('Window', `Uncaught Error: ${event.message}`, errorContext);
      // Don't prevent default - let React ErrorBoundary handle it too
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      this.error('Window', 'Unhandled Promise Rejection', {
        reason: event.reason?.message || event.reason,
        stack: event.reason?.stack,
        category: ErrorCategory.RENDERER,
      });
    });

    // Intercept console methods only in development (performance optimization)
    if (import.meta.env.DEV) {
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        originalConsoleError.apply(console, args);
        // Only forward native errors, not our formatted logs
        if (args[0] && !args[0].toString().startsWith('[')) {
          this.error('Console', args.join(' '));
        }
      };
    }
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private extractErrorContext(data: LogData): ErrorContext {
    const context: ErrorContext = {};

    if (data?.category) context.category = data.category;
    if (data?.errorCode) context.errorCode = data.errorCode;
    if (data?.stack) context.stack = data.stack;
    if (data?.userAction) context.userAction = data.userAction;
    if (data?.componentStack) context.componentStack = data.componentStack;
    if (data?.correlationId) context.correlationId = data.correlationId;

    // Extract stack trace from Error objects
    if (data?.error instanceof Error) {
      context.stack = data.error.stack;
    } else if (typeof data?.error === 'object' && data.error?.stack) {
      context.stack = data.error.stack;
    }

    // Add current URL for context
    context.url = window.location.href;

    return context;
  }

  private formatLogEntry(entry: LogEntry): string {
    const parts: string[] = [
      `[${entry.timestamp}]`,
      `[${entry.level.padEnd(5)}]`,
      `[Renderer:${entry.module.padEnd(12)}]`,
      entry.message,
    ];

    if (entry.data) {
      const sanitizedData = { ...entry.data };
      // Remove sensitive fields
      delete sanitizedData.password;
      delete sanitizedData.token;
      delete sanitizedData.apiKey;
      delete sanitizedData.secret;

      if (Object.keys(sanitizedData).length > 0) {
        parts.push(`| ${JSON.stringify(sanitizedData)}`);
      }
    }

    if (entry.errorContext) {
      if (entry.errorContext.category) {
        parts.push(`| Category: ${entry.errorContext.category}`);
      }
      if (entry.errorContext.errorCode) {
        parts.push(`| Code: ${entry.errorContext.errorCode}`);
      }
      if (entry.errorContext.userAction) {
        parts.push(`| Action: ${entry.errorContext.userAction}`);
      }
    }

    let output = parts.join(' ');

    if (entry.errorContext?.stack) {
      output += '\n' + entry.errorContext.stack;
    }

    return output;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private log(level: LogLevel, module: string, message: string, data?: LogData): void {
    if (!this.shouldLog(level)) return;

    // Track counts
    if (level === LogLevel.ERROR || level === LogLevel.FATAL) this.errorCount++;
    if (level === LogLevel.WARN) this.warnCount++;

    const levelName = LogLevel[level];
    const errorContext = level >= LogLevel.WARN ? this.extractErrorContext(data) : undefined;

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: levelName,
      module,
      message,
      data,
      errorContext,
    };

    const formatted = this.formatLogEntry(entry);

    // Console output
    switch (level) {
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        // eslint-disable-next-line no-console
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }

    // Forward to main process for persistent logging
    if (level >= LogLevel.INFO && window.api?.logToMain) {
      try {
        window.api.logToMain({
          level: levelName,
          module: `Renderer:${module}`,
          message,
          data: {
            ...data,
            errorContext,
          },
        });
      } catch (_err) {
        // Silently fail if IPC isn't available
      }
    }
  }

  createChild(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  debug(module: string, message: string, data?: LogData): void {
    this.log(LogLevel.DEBUG, module, message, data);
  }

  info(module: string, message: string, data?: LogData): void {
    this.log(LogLevel.INFO, module, message, data);
  }

  warn(module: string, message: string, data?: LogData): void {
    this.log(LogLevel.WARN, module, message, data);
  }

  error(module: string, message: string, data?: LogData): void {
    this.log(LogLevel.ERROR, module, message, data);
  }

  fatal(module: string, message: string, data?: LogData): void {
    this.log(LogLevel.FATAL, module, message, data);
  }

  startTimer(module: string, label: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.debug(module, `${label} completed`, { duration });
    };
  }

  getStats() {
    return {
      sessionDuration: Date.now() - this.sessionStartTime,
      errorCount: this.errorCount,
      warnCount: this.warnCount,
    };
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

class ModuleLogger {
  constructor(
    private parent: RendererLogger,
    private module: string,
  ) {}

  debug(message: string, data?: LogData): void {
    this.parent.debug(this.module, message, data);
  }

  info(message: string, data?: LogData): void {
    this.parent.info(this.module, message, data);
  }

  warn(message: string, data?: LogData): void {
    this.parent.warn(this.module, message, data);
  }

  error(message: string, data?: LogData): void {
    this.parent.error(this.module, message, data);
  }

  fatal(message: string, data?: LogData): void {
    this.parent.fatal(this.module, message, data);
  }

  startTimer(label: string): () => void {
    return this.parent.startTimer(this.module, label);
  }

  errorWithCategory(message: string, category: ErrorCategory, data?: LogData): void {
    this.parent.error(this.module, message, { ...data, category });
  }
}

// Global renderer logger instance
const logger = new RendererLogger();

// Pre-configured module loggers
export const loggers = {
  app: logger.createChild('App'),
  weather: logger.createChild('Weather'),
  directory: logger.createChild('Directory'),
  ui: logger.createChild('UI'),
  location: logger.createChild('Location'),
  api: logger.createChild('API'),
  storage: logger.createChild('Storage'),
  network: logger.createChild('Network'),
};
