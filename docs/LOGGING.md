# Comprehensive Error Logging Guide

## Overview
The Relay application now has a professional-grade logging system that captures errors, warnings, and debugging information throughout both the main and renderer processes. All logs are automatically saved to disk and can be used for troubleshooting.

## Log File Locations

Logs are stored in the application's user data directory, which varies by operating system:

### **Windows**
```
C:\Users\<YourUsername>\AppData\Roaming\Relay\logs\
├── relay.log         (all logs)
├── relay.1.log       (rotated backup)
├── errors.log        (errors only)
└── errors.1.log      (rotated backup)
```

### **macOS**
```
~/Library/Application Support/Relay/logs/
├── relay.log         (all logs)
├── relay.1.log       (rotated backup)
├── errors.log        (errors only)
└── errors.1.log      (rotated backup)
```

### **Linux**
```
~/.config/Relay/logs/
├── relay.log         (all logs)
├── relay.1.log       (rotated backup)
├── errors.log        (errors only)
└── errors.1.log      (rotated backup)
```

**Note:** Logs are automatically rotated when they reach 10MB, keeping the 5 most recent backup files.

## Using the Logger

### In Main Process (Backend)

```typescript
import { loggers, ErrorCategory } from './logger';

// Simple logging
loggers.main.info('Application started');
loggers.main.debug('Processing file', { filename: 'contacts.csv' });
loggers.main.warn('Large file detected', { size: '15MB' });

// Error logging with categorization
loggers.network.error('API call failed', {
  error: err.message,
  stack: err.stack,
  category: ErrorCategory.NETWORK,
  url: 'https://api.example.com'
});

// File system errors
loggers.fileManager.error('Failed to read file', {
  error: err.message,
  stack: err.stack,
  category: ErrorCategory.FILE_SYSTEM,
  filepath: '/path/to/file.csv'
});

// Performance timing
const endTimer = loggers.main.startTimer('Database query');
// ... do work ...
endTimer(); // Logs duration automatically
```

### In Renderer Process (Frontend)

```typescript
import { loggers, ErrorCategory } from '../utils/logger';

// Component logging
loggers.ui.info('User opened settings modal');
loggers.weather.debug('Fetching weather data', { location: 'Denver, CO' });

// Error with user action context
loggers.directory.error('Failed to add contact', {
  error: err.message,
  stack: err.stack,
  category: ErrorCategory.VALIDATION,
  userAction: 'Clicked "Add Contact" button'
});

// Network errors
loggers.network.error('Weather API request failed', {
  error: err.message,
  category: ErrorCategory.NETWORK,
  userAction: 'Searched for location'
});
```

## Available Log Levels

1. **DEBUG** - Detailed technical information (only in development)
2. **INFO** - General informational messages
3. **WARN** - Warning messages that might need attention
4. **ERROR** - Error conditions that were handled
5. **FATAL** - Critical errors that may cause app termination

## Error Categories

Use these categories to classify errors for easier filtering and analysis:

- `ErrorCategory.NETWORK` - Network/API failures
- `ErrorCategory.FILE_SYSTEM` - File read/write errors
- `ErrorCategory.VALIDATION` - Data validation failures
- `ErrorCategory.AUTH` - Authentication issues
- `ErrorCategory.DATABASE` - Database/storage errors
- `ErrorCategory.IPC` - Main/Renderer communication errors
- `ErrorCategory.RENDERER` - Frontend-specific errors
- `ErrorCategory.UI` - User interface errors
- `ErrorCategory.COMPONENT` - React component errors
- `ErrorCategory.UNKNOWN` - Uncategorized errors

## Pre-configured Module Loggers

### Main Process
- `loggers.main` - Main application lifecycle
- `loggers.fileManager` - File operations
- `loggers.ipc` - IPC communication
- `loggers.security` - Security-related events
- `loggers.auth` - Authentication
- `loggers.weather` - Weather data fetching
- `loggers.location` - Location services
- `loggers.config` - Configuration changes
- `loggers.network` - Network requests

### Renderer Process
- `loggers.app` - Application-level events
- `loggers.weather` - Weather UI and data
- `loggers.directory` - Personnel directory
- `loggers.ui` - UI interactions
- `loggers.location` - Location detection
- `loggers.api` - API calls from renderer
- `loggers.storage` - LocalStorage operations
- `loggers.network` - Network requests

## Advanced Features

### Automatic Error Capture

The logger automatically captures:
- **Uncaught exceptions** in both processes
- **Unhandled promise rejections**
- **React component errors** (via ErrorBoundary)
- **Global window errors** in the renderer

### Performance Tracking

```typescript
const timer = loggers.api.startTimer('Fetch contacts');
await fetchContacts();
timer(); // Logs: "Fetch contacts completed | Duration: 245ms"
```

### Error Context

The logger automatically includes:
- **Stack traces** for all errors
- **Memory usage** (heap used/total)
- **Timestamps** (ISO 8601 format)
- **Component stacks** for React errors
- **Current URL** (renderer process)
- **Correlation IDs** (if provided)

### Example with Full Context

```typescript
try {
  await importContactsFile(filePath);
} catch (err) {
  loggers.fileManager.error('Contact import failed', {
    error: err.message,
    stack: err.stack,
    category: ErrorCategory.FILE_SYSTEM,
    userAction: 'Clicked "Import Contacts"',
    correlationId: generateId(), // For tracking related events
    filepath: filePath,
    filesize: fs.statSync(filePath).size
  });
}
```

## Replacing Old Console Statements

### Before
```typescript
console.error('[Weather] Fetch error:', err);
```

### After
```typescript
loggers.weather.error('Failed to fetch weather data', {
  error: err.message,
  stack: err.stack,
  category: ErrorCategory.NETWORK
});
```

## Best Practices

1. **Always include error category** for easier filtering
2. **Add user action context** when logging from user interactions
3. **Include relevant data** (but not sensitive information like passwords)
4. **Use appropriate log levels** - Don't log everything as ERROR
5. **Create module loggers** for new features: `logger.createChild('MyModule')`
6. **Use timing for performance** monitoring when optimizing

## Viewing Logs

### During Development
Logs appear in the console and are written to files.

### In Production

**Windows:**
1. Press `Win + R`
2. Type: `%AppData%\Relay\logs`
3. Press Enter
4. Open `relay.log` (all logs) or `errors.log` (errors only)

**macOS:**
1. Open Finder
2. Press `Cmd+Shift+G`
3. Type: `~/Library/Application Support/Relay/logs/`
4. Press Go
5. Open `relay.log` (all logs) or `errors.log` (errors only)

**Linux:**
1. Open File Manager
2. Navigate to: `~/.config/Relay/logs/`
3. Open `relay.log` (all logs) or `errors.log` (errors only)

### Sharing Logs for Support
Attach both `relay.log` and `errors.log` when reporting issues. These files contain the complete diagnostic history of your session.

## Session Markers

Each time the app starts, a session marker is written:

```
================================================================================
SESSION START: 2026-01-09T08:56:16.000Z
Platform: darwin | Node: v20.9.0 | Electron: 35.2.0
================================================================================
```

This makes it easy to identify when different sessions occurred.

## Statistics

Get logging statistics programmatically:

```typescript
import { logger } from './logger';

const stats = logger.getStats();
console.log(stats);
// {
//   sessionDuration: 3456789,  // milliseconds
//   errorCount: 3,
//   warnCount: 7,
//   logPath: '/Users/ryan/Library/Application Support/Relay/logs'
// }
```

## Security

The logger automatically sanitizes sensitive data:
- `password` fields are removed
- `token` fields are removed
- `apiKey` fields are removed
- `secret` fields are removed

**Never** log user credentials or secrets directly.
