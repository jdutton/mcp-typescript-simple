/**
 * User Allowlist Management
 *
 * Provides email-based allowlist authorization for MCP server access.
 * Configured via ALLOWED_USERS environment variable.
 */

import { logger } from './utils/logger.js';

export interface AllowlistConfig {
  enabled: boolean;
  allowedUsers: Set<string>;
}

/**
 * Load allowlist configuration from environment
 */
export function loadAllowlistConfig(): AllowlistConfig {
  const allowedUsersEnv = process.env.ALLOWED_USERS;

  if (!allowedUsersEnv || allowedUsersEnv.trim() === '') {
    logger.warn('User allowlist not configured - all authenticated users will be allowed', {
      hint: 'Set ALLOWED_USERS environment variable to restrict access'
    });

    return {
      enabled: false,
      allowedUsers: new Set()
    };
  }

  // Parse comma-separated list of email addresses
  const emails = allowedUsersEnv
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0);

  if (emails.length === 0) {
    logger.warn('ALLOWED_USERS is set but contains no valid emails', {
      value: allowedUsersEnv
    });

    return {
      enabled: false,
      allowedUsers: new Set()
    };
  }

  logger.info('User allowlist loaded', {
    count: emails.length,
    sampleEmails: emails.slice(0, 3) // Log first 3 for verification
  });

  return {
    enabled: true,
    allowedUsers: new Set(emails)
  };
}

/**
 * Check if a user email is on the allowlist
 */
export function isUserAllowed(userEmail: string | undefined, config: AllowlistConfig): boolean {
  // If allowlist is disabled, allow all authenticated users
  if (!config.enabled) {
    return true;
  }

  // If no email provided, deny access
  if (!userEmail) {
    logger.warn('Access denied - no user email provided');
    return false;
  }

  // Check if email is on allowlist (case-insensitive)
  const normalizedEmail = userEmail.trim().toLowerCase();
  const allowed = config.allowedUsers.has(normalizedEmail);

  if (!allowed) {
    logger.warn('Access denied - user not on allowlist', {
      userEmail: normalizedEmail
    });
  } else {
    logger.debug('Access granted - user on allowlist', {
      userEmail: normalizedEmail
    });
  }

  return allowed;
}

/**
 * Middleware function to check allowlist authorization
 * Returns error message if user is not allowed, undefined if allowed
 */
export function checkAllowlistAuthorization(
  userEmail: string | undefined,
  config: AllowlistConfig
): string | undefined {
  if (isUserAllowed(userEmail, config)) {
    return undefined; // User is allowed
  }

  if (!config.enabled) {
    // Shouldn't reach here, but handle gracefully
    return undefined;
  }

  if (!userEmail) {
    return 'Authentication required - no user email provided';
  }

  return `Access denied - ${userEmail} is not authorized to use this MCP server`;
}

/**
 * Add user to allowlist (runtime modification)
 * Returns true if added, false if already exists
 */
export function addUserToAllowlist(userEmail: string, config: AllowlistConfig): boolean {
  const normalizedEmail = userEmail.trim().toLowerCase();

  if (config.allowedUsers.has(normalizedEmail)) {
    return false; // Already exists
  }

  config.allowedUsers.add(normalizedEmail);
  config.enabled = true; // Enable allowlist if adding users

  logger.info('User added to allowlist', { userEmail: normalizedEmail });
  return true;
}

/**
 * Remove user from allowlist (runtime modification)
 * Returns true if removed, false if didn't exist
 */
export function removeUserFromAllowlist(userEmail: string, config: AllowlistConfig): boolean {
  const normalizedEmail = userEmail.trim().toLowerCase();

  const existed = config.allowedUsers.delete(normalizedEmail);

  if (existed) {
    logger.info('User removed from allowlist', { userEmail: normalizedEmail });
  }

  return existed;
}

/**
 * Get list of allowed users (for admin endpoints)
 */
export function getAllowedUsers(config: AllowlistConfig): string[] {
  return Array.from(config.allowedUsers).sort();
}

/**
 * Get allowlist statistics
 */
export function getAllowlistStats(config: AllowlistConfig): {
  enabled: boolean;
  userCount: number;
  users?: string[];
} {
  return {
    enabled: config.enabled,
    userCount: config.allowedUsers.size,
    users: config.enabled ? getAllowedUsers(config) : undefined
  };
}
