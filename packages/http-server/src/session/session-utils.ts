/**
 * Session utility functions
 */

import { randomUUID } from 'node:crypto';

/**
 * Generate a new session ID
 *
 * @returns A new UUID session identifier
 */
export function generateSessionId(): string {
  return randomUUID();
}
