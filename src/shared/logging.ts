/**
 * Shared logging types for main and renderer processes
 */

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
  UI = 'UI',
  COMPONENT = 'COMPONENT',
  UNKNOWN = 'UNKNOWN'
}
