/**
 * Shared logging types for main and renderer processes
 */
import type { LogData } from './types';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  NONE = 5,
}

export enum ErrorCategory {
  NETWORK = 'NETWORK',
  FILE_SYSTEM = 'FILE_SYSTEM',
  VALIDATION = 'VALIDATION',
  AUTH = 'AUTH',
  RENDERER = 'RENDERER',
  COMPONENT = 'COMPONENT',
}

export interface ErrorContext {
  category?: ErrorCategory;
  errorCode?: string;
  stack?: string;
  userAction?: string;
  correlationId?: string;
  // Main specific
  appState?: Record<string, unknown>;
  performance?: { duration?: number; timestamp: number };
  memoryUsage?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  // Renderer specific
  componentStack?: string;
  url?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: LogData;
  errorContext?: ErrorContext;
}

export interface ILogger {
  debug(module: string, message: string, data?: LogData): void;
  info(module: string, message: string, data?: LogData): void;
  warn(module: string, message: string, data?: LogData): void;
  error(module: string, message: string, data?: LogData): void;
  fatal(module: string, message: string, data?: LogData): void;
  startTimer(module: string, label: string): () => void;
}

/**
 * Child logger with a fixed module name for cleaner API
 */
export class ModuleLogger {
  private readonly parent: ILogger;
  private readonly module: string;

  constructor(parent: ILogger, module: string) {
    this.parent = parent;
    this.module = module;
  }

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

  /**
   * Create a performance timer
   */
  startTimer(label: string): () => void {
    return this.parent.startTimer(this.module, label);
  }

  /**
   * Log with error category
   */
  errorWithCategory(message: string, category: ErrorCategory, data?: LogData): void {
    const errorData =
      typeof data === 'object' && data !== null ? { ...data, category } : { value: data, category };
    this.parent.error(this.module, message, errorData as LogData);
  }
}
