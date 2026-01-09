# Logging Best Practices - Quick Reference

## ✅ DO's

### Use Structured Logging

```typescript
// ✅ CORRECT - Use proper logger
import { loggers, ErrorCategory } from './logger';

loggers.fileManager.error('Path validation failed', {
  errorCode: error.code,
  category: ErrorCategory.FILE_SYSTEM
});
```

### Use Appropriate Log Levels

```typescript
// ✅ DEBUG - Development diagnostics
loggers.main.debug('Processing data', { count: items.length });

// ✅ INFO - Normal operations
loggers.main.info('FileManager initialized', { path: dataRoot });

// ✅ WARN - Recoverable issues
loggers.ipc.warn('Rate limited', { retryAfterMs: 1000 });

// ✅ ERROR - Handled errors
loggers.network.error('API request failed', {
  category: ErrorCategory.NETWORK,
  errorCode: error.code
});

// ✅ FATAL - Unrecoverable errors
loggers.main.fatal('Critical system failure', {
  error: error.message,
  stack: error.stack
});
```

### Use Error Categories

```typescript
// ✅ Always categorize errors
import { ErrorCategory } from './logger';

loggers.auth.error('Authentication failed', {
  category: ErrorCategory.AUTH,
  host: authRequest.host
});

// Available categories:
// - NETWORK
// - FILE_SYSTEM
// - VALIDATION
// - AUTH
// - DATABASE
// - IPC
// - RENDERER
// - UI
// - COMPONENT
// - UNKNOWN
```

### Filter Sensitive Data

```typescript
// ✅ Logger automatically filters these fields:
// - password
// - token
// - apiKey
// - secret

// But you should still avoid logging them:
loggers.security.info('User authenticated', {
  username: user.username,
  // ❌ Don't log: password, apiKey, etc.
});
```

## ❌ DON'Ts

### Never Use Console Methods

```typescript
// ❌ WRONG - Don't use console methods
console.log('Processing data...');
console.error('Failed to load:', error);
console.warn('Deprecated feature');

// ✅ CORRECT - Use structured logger
loggers.app.debug('Processing data');
loggers.app.error('Failed to load', { error });
loggers.app.warn('Deprecated feature used');
```

### Never Log Sensitive Information

```typescript
// ❌ WRONG - Exposes credentials
loggers.auth.info('Login attempt', {
  username: username,
  password: password  // ❌ NEVER LOG PASSWORDS
});

// ✅ CORRECT
loggers.auth.info('Login attempt', {
  username: username
  // Password automatically filtered if accidentally included
});
```

### Never Log Full Paths in Production

```typescript
// ❌ WRONG - Information disclosure
loggers.main.error(`File not found: ${fullPath}`);

// ✅ CORRECT
loggers.main.error('File not found', {
  category: ErrorCategory.FILE_SYSTEM,
  errorCode: 'ENOENT'
  // Path is not logged
});
```

## 🎯 Examples by Use Case

### File Operations

```typescript
loggers.fileManager.info('Reading data file', {
  category: ErrorCategory.FILE_SYSTEM
});

try {
  const data = await fs.promises.readFile(filePath);
  loggers.fileManager.debug('File read successfully', {
    sizeBytes: data.length
  });
} catch (error: any) {
  loggers.fileManager.error('Failed to read file', {
    errorCode: error.code,
    category: ErrorCategory.FILE_SYSTEM,
    stack: error.stack
  });
}
```

### Network Requests

```typescript
loggers.network.info('Fetching weather data', {
  lat, lon
});

try {
  const response = await fetch(url);
  loggers.network.debug('Weather data received', {
    statusCode: response.status
  });
} catch (error: any) {
  loggers.network.error('Weather API failed', {
    error: error.message,
    category: ErrorCategory.NETWORK
  });
}
```

### IPC Operations

```typescript
loggers.ipc.debug('Handling IPC request', {
  channel: IPC_CHANNELS.ADD_CONTACT
});

if (!rateLimiter.tryConsume()) {
  loggers.ipc.warn('Rate limited', {
    channel: channelName,
    retryAfterMs: 1000
  });
  return null;
}
```

### Renderer Process

```typescript
import { loggers, ErrorCategory } from '@renderer/utils/logger';

try {
  await window.api.addContact(contact);
  loggers.app.info('Contact added successfully');
} catch (error: any) {
  loggers.app.error('Failed to add contact', {
    error: error.message,
    category: ErrorCategory.UI,
    userAction: 'Add Contact'
  });
}
```

### Performance Tracking

```typescript
const endTimer = loggers.main.startTimer('Data initialization');

// ... do work ...

endTimer(); // Logs: "Data initialization completed | Duration: 123ms"
```

## 🔍 Finding Logs

### Main Process Logs
**Location:** `~/Library/Application Support/Relay/logs/`
- `relay.log` - All logs (INFO and above)
- `errors.log` - Errors only (ERROR and FATAL)

### Log Format
```
[2026-01-09T09:17:21.152Z] [INFO ] [FileManager    ] Message here | Data: {...} | Category: FILE_SYSTEM
```

### Log Rotation
- Auto-rotates at 10MB
- Keeps last 5 log files
- Named: `relay.1.log`, `relay.2.log`, etc.

## 🛠️ Development vs Production

### Development (npm run dev)
- **Log Level:** DEBUG
- **Console Interception:** Enabled
- **Stack Traces:** Full detail
- **Memory Tracking:** Every 5 seconds

### Production (npm run build)
- **Log Level:** INFO  
- **Console Interception:** Disabled (performance)
- **Stack Traces:** Sanitized (security)
- **Memory Tracking:** Every 5 seconds

## 📚 Quick Reference Card

```typescript
// Import
import { loggers, ErrorCategory } from './logger';        // Main process
import { loggers, ErrorCategory } from '@renderer/utils/logger'; // Renderer

// Log Levels (by severity)
loggers.module.debug(msg, data);   // Development only
loggers.module.info(msg, data);    // Normal operations
loggers.module.warn(msg, data);    // Recoverable issues  
loggers.module.error(msg, data);   // Handled errors
loggers.module.fatal(msg, data);   // Unrecoverable errors

// Available Modules (Main Process)
loggers.main
loggers.fileManager
loggers.ipc
loggers.bridge
loggers.security
loggers.auth
loggers.weather
loggers.location
loggers.config
loggers.network

// Available Modules (Renderer Process)
loggers.app
loggers.weather
loggers.directory
loggers.ui
loggers.location
loggers.api
loggers.storage
loggers.network

// Error Categories
ErrorCategory.NETWORK
ErrorCategory.FILE_SYSTEM
ErrorCategory.VALIDATION
ErrorCategory.AUTH
ErrorCategory.DATABASE
ErrorCategory.IPC
ErrorCategory.RENDERER
ErrorCategory.UI
ErrorCategory.COMPONENT
ErrorCategory.UNKNOWN

// Performance Timing
const endTimer = loggers.module.startTimer('Operation name');
// ... work ...
endTimer(); // Logs duration automatically
```

---

**Remember:** Consistent logging is critical for production debugging. When in doubt, use INFO level with appropriate error categories.
