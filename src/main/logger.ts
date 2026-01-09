import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Constants
const LOG_BATCH_SIZE = 100;
const SESSION_START_BORDER_LENGTH = 80;
const MEMORY_SAMPLE_INTERVAL_MS = 5000; // Sample memory every 5 seconds
const MB_DIVISOR = 1024 * 1024;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  NONE = 5
}

export enum ErrorCategory {
  NETWORK = 'NETWORK',
  FILE_SYSTEM = 'FILE_SYSTEM',
  VALIDATION = 'VALIDATION',
  AUTH = 'AUTH',
  DATABASE = 'DATABASE',
  IPC = 'IPC',
  RENDERER = 'RENDERER',
  UNKNOWN = 'UNKNOWN'
}

interface ErrorContext {
  category?: ErrorCategory;
  errorCode?: string;
  stack?: string;
  userAction?: string;
  appState?: any;
  performance?: PerformanceMetrics;
  memoryUsage?: NodeJS.MemoryUsage;
  correlationId?: string;
}

interface PerformanceMetrics {
  duration?: number;
  timestamp: number;
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: any;
  errorContext?: ErrorContext;
}

interface LoggerConfig {
  level: LogLevel;
  console: boolean;
  file: boolean;
  maxFileSize: number;
  maxFiles: number;
  includePerformanceMetrics: boolean;
  includeMemoryUsage: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  console: true,
  file: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB (increased for detailed logging)
  maxFiles: 5, // Keep more historical logs
  includePerformanceMetrics: true,
  includeMemoryUsage: true
};

class Logger {
  private config: LoggerConfig;
  private logPath: string;
  private currentLogFile: string;
  private errorLogFile: string;
  private writeQueue: string[] = [];
  private errorQueue: string[] = [];
  private isWriting = false;
  private sessionStartTime: number;
  private errorCount = 0;
  private warnCount = 0;
  private lastMemorySample = 0;
  private initialized = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionStartTime = Date.now();
    
    // Lazy initialization to handle environments where app isn't ready
    if (app && typeof app.isReady === 'function' && app.isReady()) {
      this.initialize();
    } else {
      // Wait for app to be ready
      if (app && typeof app.whenReady === 'function') {
        app.whenReady().then(() => this.initialize()).catch(() => {
          // If app doesn't initialize (e.g., in tests), use fallback
          this.logPath = '/tmp/relay-logs';
          this.currentLogFile = '/tmp/relay-logs/relay.log';
          this.errorLogFile = '/tmp/relay-logs/errors.log';
          this.initialized = true;
        });
      } else {
        // In test environment without proper app mock
        this.logPath = '/tmp/relay-logs';
        this.currentLogFile = '/tmp/relay-logs/relay.log';
        this.errorLogFile = '/tmp/relay-logs/errors.log';
        this.initialized = true;
      }
    }
    
    this.setupGlobalErrorHandlers();
  }

  private initialize(): void {
    if (this.initialized) return;
    
    this.logPath = path.join(app.getPath('userData'), 'logs');
    this.currentLogFile = path.join(this.logPath, 'relay.log');
    this.errorLogFile = path.join(this.logPath, 'errors.log');
    this.initialized = true;
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logPath)) {
        fs.mkdirSync(this.logPath, { recursive: true });
      }
      // Write session start marker
      const sessionMarker = `\n${'='.repeat(SESSION_START_BORDER_LENGTH)}\nSESSION START: ${new Date().toISOString()}\nPlatform: ${process.platform} | Node: ${process.version} | Electron: ${process.versions.electron}\n${'='.repeat(SESSION_START_BORDER_LENGTH)}\n`;
      fs.appendFileSync(this.currentLogFile, sessionMarker);
    } catch (e) {
      console.error('[Logger] Failed to create log directory:', e);
    }
  }

  private setupGlobalErrorHandlers(): void {
    // Catch uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.fatal('Process', 'Uncaught Exception', {
        error: error.message,
        stack: error.stack,
        category: ErrorCategory.UNKNOWN
      });
      // Don't exit immediately - let the log flush
      setTimeout(() => process.exit(1), 1000);
    });

    // Catch unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.error('Process', 'Unhandled Promise Rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack,
        category: ErrorCategory.UNKNOWN
      });
    });

    // Log warnings
    process.on('warning', (warning: Error) => {
      this.warn('Process', 'Process Warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private extractErrorContext(data: any): ErrorContext {
    const context: ErrorContext = {};
    
    if (data?.category) context.category = data.category;
    if (data?.errorCode) context.errorCode = data.errorCode;
    if (data?.stack) context.stack = data.stack;
    if (data?.userAction) context.userAction = data.userAction;
    if (data?.appState) context.appState = data.appState;
    if (data?.correlationId) context.correlationId = data.correlationId;
    
    // Extract stack trace from Error objects
    if (data?.error instanceof Error) {
      context.stack = data.error.stack;
    } else if (typeof data?.error === 'object' && data.error?.stack) {
      context.stack = data.error.stack;
    }
    
    // Add performance metrics if enabled
    if (this.config.includePerformanceMetrics) {
      context.performance = {
        timestamp: Date.now(),
        duration: data?.duration
      };
    }
    
    // Add memory usage if enabled (sampled to reduce overhead)
    if (this.config.includeMemoryUsage) {
      const now = Date.now();
      if (now - this.lastMemorySample >= MEMORY_SAMPLE_INTERVAL_MS) {
        context.memoryUsage = process.memoryUsage();
        this.lastMemorySample = now;
      }
    }
    
    return context;
  }

  private formatLogEntry(entry: LogEntry): string {
    const parts: string[] = [
      `[${entry.timestamp}]`,
      `[${entry.level.padEnd(5)}]`,
      `[${entry.module.padEnd(15)}]`,
      entry.message
    ];

    // Add standard data
    if (entry.data) {
      const sanitizedData = { ...entry.data };
      // Remove sensitive fields
      delete sanitizedData.password;
      delete sanitizedData.token;
      delete sanitizedData.apiKey;
      delete sanitizedData.secret;
      
      if (Object.keys(sanitizedData).length > 0) {
        parts.push(`| Data: ${JSON.stringify(sanitizedData)}`);
      }
    }

    // Add error context if present
    if (entry.errorContext) {
      if (entry.errorContext.category) {
        parts.push(`| Category: ${entry.errorContext.category}`);
      }
      if (entry.errorContext.errorCode) {
        parts.push(`| Code: ${entry.errorContext.errorCode}`);
      }
      if (entry.errorContext.correlationId) {
        parts.push(`| CID: ${entry.errorContext.correlationId}`);
      }
      if (entry.errorContext.userAction) {
        parts.push(`| Action: ${entry.errorContext.userAction}`);
      }
      if (entry.errorContext.performance?.duration) {
        parts.push(`| Duration: ${entry.errorContext.performance.duration}ms`);
      }
      if (entry.errorContext.memoryUsage) {
        const mem = entry.errorContext.memoryUsage;
        parts.push(`| Mem: ${Math.round(mem.heapUsed / MB_DIVISOR)}MB/${Math.round(mem.heapTotal / MB_DIVISOR)}MB`);
      }
    }

    let output = parts.join(' ');

    // Add stack trace on new lines if present
    if (entry.errorContext?.stack) {
      output += '\n' + this.formatStackTrace(entry.errorContext.stack);
    }

    return output;
  }

  private formatStackTrace(stack: string): string {
    return stack
      .split('\n')
      .map(line => `    ${line}`)
      .join('\n');
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private async rotateIfNeeded(filePath: string): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) return;

      const stats = fs.statSync(filePath);
      if (stats.size < this.config.maxFileSize) return;

      const baseName = path.basename(filePath, '.log');
      const dirName = path.dirname(filePath);

      for (let i = this.config.maxFiles; i >= 1; i--) {
        const oldFile = path.join(dirName, `${baseName}.${i}.log`);
        const newFile = path.join(dirName, `${baseName}.${i + 1}.log`);
        if (fs.existsSync(oldFile)) {
          if (i === this.config.maxFiles) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      fs.renameSync(filePath, path.join(dirName, `${baseName}.1.log`));
    } catch (e) {
      console.error('[Logger] Failed to rotate logs:', e);
    }
  }

  private async writeToFile(line: string, isError = false): Promise<void> {
    if (!this.config.file || !this.initialized) return;

    const queue = isError ? this.errorQueue : this.writeQueue;
    queue.push(line);

    if (this.isWriting) return;
    this.isWriting = true;

    try {
      // Rotate both files if needed
      await this.rotateIfNeeded(this.currentLogFile);
      await this.rotateIfNeeded(this.errorLogFile);

      // Write main log queue (async)
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, LOG_BATCH_SIZE).join('\n') + '\n';
        await fs.promises.appendFile(this.currentLogFile, batch);
      }

      // Write error log queue (async)
      while (this.errorQueue.length > 0) {
        const batch = this.errorQueue.splice(0, LOG_BATCH_SIZE).join('\n') + '\n';
        await fs.promises.appendFile(this.errorLogFile, batch);
      }
    } catch (e) {
      console.error('[Logger] Failed to write to log file:', e);
    } finally {
      this.isWriting = false;
    }
  }

  private log(level: LogLevel, module: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    // Track error/warn counts
    if (level === LogLevel.ERROR || level === LogLevel.FATAL) this.errorCount++;
    if (level === LogLevel.WARN) this.warnCount++;

    const levelName = LogLevel[level];
    const errorContext = (level >= LogLevel.WARN) ? this.extractErrorContext(data) : undefined;
    
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: levelName,
      module,
      message,
      data,
      errorContext
    };

    const formatted = this.formatLogEntry(entry);

    if (this.config.console) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formatted);
          break;
        case LogLevel.INFO:
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
    }

    // Write to appropriate log file(s)
    const isError = level >= LogLevel.ERROR;
    this.writeToFile(formatted, isError);
  }

  /**
   * Create a child logger with a fixed module name
   */
  createChild(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  debug(module: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, module, message, data);
  }

  info(module: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, module, message, data);
  }

  warn(module: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, module, message, data);
  }

  error(module: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, module, message, data);
  }

  fatal(module: string, message: string, data?: any): void {
    this.log(LogLevel.FATAL, module, message, data);
  }

  /**
   * Performance tracking helper
   */
  startTimer(module: string, label: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.debug(module, `${label} completed`, { duration });
    };
  }

  /**
   * Get logging statistics
   */
  getStats() {
    return {
      sessionDuration: Date.now() - this.sessionStartTime,
      errorCount: this.errorCount,
      warnCount: this.warnCount,
      logPath: this.logPath
    };
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

/**
 * Child logger with a fixed module name for cleaner API
 */
class ModuleLogger {
  constructor(private parent: Logger, private module: string) {}

  debug(message: string, data?: any): void {
    this.parent.debug(this.module, message, data);
  }

  info(message: string, data?: any): void {
    this.parent.info(this.module, message, data);
  }

  warn(message: string, data?: any): void {
    this.parent.warn(this.module, message, data);
  }

  error(message: string, data?: any): void {
    this.parent.error(this.module, message, data);
  }

  fatal(message: string, data?: any): void {
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
  errorWithCategory(message: string, category: ErrorCategory, data?: any): void {
    this.parent.error(this.module, message, { ...data, category });
  }
}

// Global logger instance
export const logger = new Logger({
  level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO
});

// Pre-configured module loggers for common modules
export const loggers = {
  main: logger.createChild('Main'),
  fileManager: logger.createChild('FileManager'),
  ipc: logger.createChild('IPC'),
  bridge: logger.createChild('Bridge'),
  security: logger.createChild('Security'),
  auth: logger.createChild('Auth'),
  weather: logger.createChild('Weather'),
  location: logger.createChild('Location'),
  config: logger.createChild('Config'),
  network: logger.createChild('Network')
};
