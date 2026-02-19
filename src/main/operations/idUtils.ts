/**
 * Shared ID generation utility
 * All entity IDs follow the pattern: {prefix}_{timestamp}_{uuid}
 */

import { randomUUID } from 'crypto';

/**
 * Generate a unique ID with a given prefix.
 * Format: `{prefix}_{Date.now()}_{randomUUID()}`
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomUUID()}`;
}
