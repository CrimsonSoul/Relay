/**
 * Environment Variable Validation Utility
 * 
 * Ensures all required environment variables are present and correctly formatted.
 * Should be called early in the main process startup.
 */

import { loggers, ErrorCategory } from './logger';

interface EnvSchema {
  [key: string]: {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean';
    pattern?: RegExp;
    defaultValue?: any;
    validate?: (value: any) => boolean;
  };
}

const SCHEMA: EnvSchema = {
  NODE_ENV: {
    type: 'string',
    defaultValue: 'production',
    validate: (v) => ['development', 'production', 'test'].includes(v)
  },
  ELECTRON_ENABLE_LOGGING: {
    type: 'boolean',
    defaultValue: false
  },
  ELECTRON_RENDERER_URL: {
    type: 'string', // Only in dev
    required: false
  }
};

/**
 * Validates process.env against the defined schema.
 * Sets default values for missing variables and logs warnings for invalid ones.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  for (const [key, config] of Object.entries(SCHEMA)) {
    let value = process.env[key];

    // Check if required
    if (config.required && value === undefined) {
      errors.push(`Missing required environment variable: ${key}`);
      continue;
    }

    // Set default value if missing
    if (value === undefined && config.defaultValue !== undefined) {
      process.env[key] = String(config.defaultValue);
      continue;
    }

    if (value !== undefined) {
      // Type validation
      if (config.type === 'number' && isNaN(Number(value))) {
        errors.push(`Environment variable ${key} must be a number, got: ${value}`);
      } else if (config.type === 'boolean' && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
        errors.push(`Environment variable ${key} must be a boolean, got: ${value}`);
      }

      // Pattern validation
      if (config.pattern && !config.pattern.test(value)) {
        errors.push(`Environment variable ${key} does not match required pattern`);
      }

      // Custom validation
      if (config.validate && !config.validate(value)) {
        errors.push(`Environment variable ${key} failed custom validation`);
      }
    }
  }

  if (errors.length > 0) {
    loggers.main.error('Environment validation errors detected', {
      errors,
      category: ErrorCategory.VALIDATION
    });
    
    // In production, we might want to fail fast for CRITICAL env vars
    // For now, we just log them.
  } else {
    loggers.main.info('Environment variables validated successfully');
  }
}
