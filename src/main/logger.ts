import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: any;
}

interface LoggerConfig {
  level: LogLevel;
  console: boolean;
  file: boolean;
  maxFileSize: number;    // Max log file size in bytes
  maxFiles: number;       // Number of rotated files to keep
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  console: true,
  file: true,
  maxFileSize: 5 * 1024 * 1024, // 5MB
  maxFiles: 3
};

class Logger {
  private config: LoggerConfig;
  private logPath: string;
  private currentLogFile: string;
  private writeQueue: string[] = [];
  private isWriting = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logPath = path.join(app.getPath('userData'), 'logs');
    this.currentLogFile = path.join(this.logPath, 'relay.log');
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logPath)) {
        fs.mkdirSync(this.logPath, { recursive: true });
      }
    } catch (e) {
      console.error('[Logger] Failed to create log directory:', e);
    }
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }

  private formatLogEntry(entry: LogEntry): string {
    const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    return `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.message}${dataStr}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      if (!fs.existsSync(this.currentLogFile)) return;

      const stats = fs.statSync(this.currentLogFile);
      if (stats.size < this.config.maxFileSize) return;

      // Rotate logs
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const oldFile = path.join(this.logPath, `relay.${i}.log`);
        const newFile = path.join(this.logPath, `relay.${i + 1}.log`);
        if (fs.existsSync(oldFile)) {
          if (i === this.config.maxFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Rotate current log
      fs.renameSync(this.currentLogFile, path.join(this.logPath, 'relay.1.log'));
    } catch (e) {
      console.error('[Logger] Failed to rotate logs:', e);
    }
  }

  private async writeToFile(line: string): Promise<void> {
    if (!this.config.file) return;

    this.writeQueue.push(line);

    if (this.isWriting) return;
    this.isWriting = true;

    try {
      await this.rotateIfNeeded();

      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, 100).join('\n') + '\n';
        fs.appendFileSync(this.currentLogFile, batch);
      }
    } catch (e) {
      console.error('[Logger] Failed to write to log file:', e);
    } finally {
      this.isWriting = false;
    }
  }

  private log(level: LogLevel, module: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const levelName = LogLevel[level];
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: levelName,
      module,
      message,
      data
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
          console.error(formatted);
          break;
      }
    }

    this.writeToFile(formatted);
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
  auth: logger.createChild('Auth')
};
