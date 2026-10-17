/**
 * Environment Variable Validation Utility
 *
 * Applies defaults and reports malformed values for the environment variables
 * Relay reads. Should be called early in the main process startup.
 */

import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';

interface EnvSchema {
  [key: string]: {
    type?: 'string' | 'boolean';
    defaultValue?: string | boolean;
    validate?: (_value: string) => boolean;
  };
}

const SCHEMA: EnvSchema = {
  NODE_ENV: {
    type: 'string',
    defaultValue: 'production',
    validate: (v) => ['development', 'production', 'test'].includes(v),
  },
  ELECTRON_ENABLE_LOGGING: {
    type: 'boolean',
    defaultValue: false,
  },
  ELECTRON_RENDERER_URL: {
    type: 'string', // Only in dev
  },
};

function validateValue(key: string, config: EnvSchema[string], value: string, errors: string[]) {
  if (config.type === 'boolean' && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
    errors.push(`Environment variable ${key} must be a boolean, got: ${value}`);
  }
  if (config.validate && !config.validate(value)) {
    errors.push(`Environment variable ${key} failed custom validation`);
  }
}

/**
 * Validates process.env against the defined schema.
 * Sets default values for missing variables and logs invalid ones; none are fatal.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  for (const [key, config] of Object.entries(SCHEMA)) {
    const value = process.env[key];
    if (value === undefined) {
      if (config.defaultValue !== undefined) process.env[key] = String(config.defaultValue);
    } else {
      validateValue(key, config, value, errors);
    }
  }

  if (errors.length > 0) {
    loggers.main.error('Environment validation errors detected', {
      errors,
      category: ErrorCategory.VALIDATION,
    });
  } else {
    loggers.main.info('Environment variables validated successfully');
  }
}
