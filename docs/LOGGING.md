# Comprehensive Error Logging Guide

## Overview

The Relay application has a professional-grade logging system that captures errors, warnings, and debugging information throughout both the main and renderer processes. All logs are automatically saved to disk and can be used for troubleshooting.

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
  url: 'https://api.example.com',
});
```

### In Renderer Process (Frontend)

```typescript
import { loggers, ErrorCategory } from '../utils/logger';

// Component logging
loggers.ui.info('User opened settings modal');

// Error with user action context
loggers.directory.error('Failed to add contact', {
  error: err.message,
  stack: err.stack,
  category: ErrorCategory.VALIDATION,
  userAction: 'Clicked "Add Contact" button',
});
```

## Best Practices

### ✅ DO's

- **Use Structured Logging**: Always use the provided module loggers instead of `console`.
- **Use Appropriate Log Levels**:
  - `DEBUG`: Technical details for development.
  - `INFO`: Significant application milestones.
  - `WARN`: Issues that don't stop the app but need attention.
  - `ERROR`: Handled failures.
  - `FATAL`: Critical failures that crash the app.
- **Categorize Errors**: Always include an `ErrorCategory` for filtering.
- **Include Context**: Use the data object to provide relevant IDs or state (excluding secrets).

### ❌ DON'Ts

- **Never use `console.log` or `console.error`**: They are not captured by the persistent logging system in production.
- **Never log sensitive data**: Passwords, API keys, and tokens are automatically filtered, but it's best practice to avoid them entirely in log calls.
- **Don't over-log**: Avoid logging inside tight loops or for trivial UI events.

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

## Available Modules

### Main Process

- `loggers.main`, `loggers.fileManager`, `loggers.ipc`, `loggers.security`, `loggers.auth`, `loggers.weather`, `loggers.location`, `loggers.config`, `loggers.network`

### Renderer Process

- `loggers.app`, `loggers.weather`, `loggers.directory`, `loggers.ui`, `loggers.location`, `loggers.api`, `loggers.storage`, `loggers.network`

## Viewing Logs in Production

- **Windows**: `%AppData%\Relay\logs`
- **macOS**: `~/Library/Application Support/Relay/logs/`
- **Linux**: `~/.config/Relay/logs/`
