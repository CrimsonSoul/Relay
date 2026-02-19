/**
 * Common Error Logging Patterns & Examples
 *
 * This file demonstrates best practices for using the comprehensive
 * logging system in the Relay application.
 */

// ============================================================================
// MAIN PROCESS EXAMPLES
// ============================================================================

import { loggers, ErrorCategory } from '../main/logger';

// -----------------------------------------------------------------------------
// 1. Network/API Errors
// -----------------------------------------------------------------------------

async function fetchWeatherData(lat: number, lon: number) {
  const timer = loggers.weather.startTimer('Weather API request');

  try {
    const response = await fetch(`https://api.example.com/weather?lat=${lat}&lon=${lon}`);

    if (!response.ok) {
      loggers.weather.warn('Weather API returned non-OK status', {
        status: response.status,
        statusText: response.statusText,
        category: ErrorCategory.NETWORK,
        lat,
        lon,
      });
    }

    const data = await response.json();
    loggers.weather.info('Weather data fetched successfully', {
      location: `${lat},${lon}`,
      records: data.hourly?.length || 0,
    });

    timer(); // Logs completion with duration
    return data;
  } catch (err: any) {
    loggers.weather.error('Failed to fetch weather data', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.NETWORK,
      lat,
      lon,
      userAction: 'User searched for weather location',
    });
    timer(); // Still log duration even on failure
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 2. File System Errors
// -----------------------------------------------------------------------------

import * as fs from 'fs';

async function readContactsFile(filePath: string) {
  loggers.fileManager.debug('Reading contacts file', { filePath });

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    loggers.fileManager.info('Contacts file read successfully', {
      filePath,
      sizeBytes: content.length,
    });
    return content;
  } catch (err: any) {
    loggers.fileManager.error('Failed to read contacts file', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.FILE_SYSTEM,
      errorCode: err.code, // e.g., 'ENOENT', 'EACCES'
      filePath,
    });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 3. Validation Errors
// -----------------------------------------------------------------------------

function validateContact(contact: any) {
  const errors: string[] = [];

  if (!contact.email || !isValidEmail(contact.email)) {
    errors.push('Invalid email address');
    loggers.fileManager.warn('Contact validation failed: invalid email', {
      category: ErrorCategory.VALIDATION,
      email: contact.email,
      userAction: 'User attempted to add contact',
    });
  }

  if (!contact.name || contact.name.trim().length === 0) {
    errors.push('Name is required');
    loggers.fileManager.warn('Contact validation failed: missing name', {
      category: ErrorCategory.VALIDATION,
      contact: { email: contact.email }, // Don't log full invalid data
    });
  }

  if (errors.length > 0) {
    loggers.fileManager.error('Contact validation failed', {
      category: ErrorCategory.VALIDATION,
      errors,
      userAction: 'User submitted contact form',
    });
    throw new Error(errors.join(', '));
  }

  loggers.fileManager.debug('Contact validated successfully', {
    email: contact.email,
  });
}

// -----------------------------------------------------------------------------
// 4. Authentication Errors
// -----------------------------------------------------------------------------

import { cacheCredentials } from '../main/credentialManager';

function handleAuthAttempt(host: string, username: string, password: string, remember: boolean) {
  loggers.auth.info('Authentication attempt', {
    host,
    username,
    remember,
    // Never log passwords!
  });

  try {
    if (remember) {
      const cached = cacheCredentials(host, username, password);
      if (cached) {
        loggers.auth.info('Credentials cached successfully', { host, username });
      } else {
        loggers.auth.warn('Failed to cache credentials', {
          host,
          username,
          category: ErrorCategory.AUTH,
        });
      }
    }

    loggers.auth.info('Authentication successful', { host, username });
  } catch (err: any) {
    loggers.auth.error('Authentication failed', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.AUTH,
      host,
      username,
      userAction: 'User submitted login form',
    });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 5. IPC Errors
// -----------------------------------------------------------------------------

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';

export function setupDataHandlers() {
  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT, async (_event, contact) => {
    loggers.ipc.debug('IPC request: add contact', { email: contact.email });

    try {
      const result = await addContactToFile(contact);

      loggers.ipc.info('Contact added successfully', {
        email: contact.email,
        correlationId: generateId(), // Track related events
      });

      return result;
    } catch (err: any) {
      loggers.ipc.error('Failed to add contact via IPC', {
        error: err.message,
        stack: err.stack,
        category: ErrorCategory.IPC,
        contact: { email: contact.email },
      });
      throw err;
    }
  });
}

// ============================================================================
// RENDERER PROCESS EXAMPLES
// ============================================================================

import { loggers, ErrorCategory } from '../renderer/src/utils/logger';

// -----------------------------------------------------------------------------
// 6. React Component Errors (Handled by ErrorBoundary)
// -----------------------------------------------------------------------------

// Component errors are automatically logged by ErrorBoundary.
// You don't need to do anything special - just wrap your app:
//
// <ErrorBoundary>
//   <App />
// </ErrorBoundary>

// -----------------------------------------------------------------------------
// 7. User Action Logging
// -----------------------------------------------------------------------------

function handleButtonClick(action: string) {
  loggers.ui.debug('User clicked button', {
    action,
    userAction: 'Clicked refresh data button',
  });

  try {
    performAction(action);
    loggers.ui.info('Action completed successfully', { action });
  } catch (err: any) {
    loggers.ui.error('Action failed', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.UI,
      action,
      userAction: `Clicked ${action} button`,
    });

    // Show user-friendly error toast
    showToast(`Failed to ${action}. Please try again.`, 'error');
  }
}

// -----------------------------------------------------------------------------
// 8. Async Data Fetching
// -----------------------------------------------------------------------------

async function loadWeatherData(location: string) {
  loggers.weather.info('Loading weather data', { location });
  const timer = loggers.weather.startTimer('Load weather');

  try {
    const data = await window.api.getWeather(lat, lon);

    loggers.weather.info('Weather data loaded', {
      location,
      hourlyCount: data?.hourly?.length || 0,
      hasAlerts: data?.alerts?.length > 0,
    });

    timer();
    return data;
  } catch (err: any) {
    loggers.weather.error('Failed to load weather data', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.NETWORK,
      location,
      userAction: 'User searched for weather location',
    });

    timer();
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 9. LocalStorage Operations
// -----------------------------------------------------------------------------

function saveUserPreference(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    loggers.storage.debug('Saved user preference', { key });
  } catch (err: any) {
    loggers.storage.error('Failed to save user preference', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.RENDERER,
      key,
      // Don't log the value - might be large
      userAction: 'User changed settings',
    });
  }
}

// -----------------------------------------------------------------------------
// 10. State Management Errors
// -----------------------------------------------------------------------------

import { useState, useEffect } from 'react';

function useDataLoader<T>(fetchFn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const timer = loggers.api.startTimer('Data load');

    fetchFn()
      .then((result) => {
        setData(result);
        loggers.api.debug('Data loaded successfully');
        timer();
      })
      .catch((err) => {
        loggers.api.error('Failed to load data', {
          error: err.message,
          stack: err.stack,
          category: ErrorCategory.NETWORK,
        });
        setError(err);
        timer();
      });
  }, deps);

  return { data, error };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function addContactToFile(contact: any): Promise<boolean> {
  // Implementation
  return Promise.resolve(true);
}

function performAction(action: string): void {
  // Implementation
}

function showToast(message: string, type: string): void {
  // Implementation
}

// ============================================================================
// BEST PRACTICES SUMMARY
// ============================================================================

/*
  1. ALWAYS include error category for better filtering
  2. ALWAYS include stack traces for errors
  3. ALWAYS add user action context when logging from UI interactions
  4. NEVER log sensitive data (passwords, tokens, API keys)
  5. USE performance timers for operations you might optimize
  6. USE correlation IDs to track related events across logs
  7. USE appropriate log levels:
     - DEBUG: Technical details, only in development
     - INFO: General events, successful operations
     - WARN: Potential issues that were handled
     - ERROR: Errors that were caught and handled
     - FATAL: Critical errors that may crash the app
  8. INCLUDE relevant context (file paths, URLs, user actions, etc.)
  9. CREATE module loggers for new features
  10. LOG both success and failure for important operations
*/

export {};
