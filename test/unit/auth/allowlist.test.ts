/**
 * Tests for user allowlist functionality
 */

import {
  loadAllowlistConfig,
  isUserAllowed,
  checkAllowlistAuthorization,
  addUserToAllowlist,
  removeUserFromAllowlist,
  getAllowedUsers,
  getAllowlistStats,
  type AllowlistConfig
} from '../../../src/auth/allowlist.js';

describe('User Allowlist', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadAllowlistConfig', () => {
    it('should return disabled config when ALLOWED_USERS not set', () => {
      delete process.env.ALLOWED_USERS;

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(false);
      expect(config.allowedUsers.size).toBe(0);
    });

    it('should return disabled config when ALLOWED_USERS is empty', () => {
      process.env.ALLOWED_USERS = '';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(false);
      expect(config.allowedUsers.size).toBe(0);
    });

    it('should load single email address', () => {
      process.env.ALLOWED_USERS = 'user@example.com';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(true);
      expect(config.allowedUsers.size).toBe(1);
      expect(config.allowedUsers.has('user@example.com')).toBe(true);
    });

    it('should load multiple email addresses', () => {
      process.env.ALLOWED_USERS = 'user1@example.com,user2@example.com,user3@example.com';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(true);
      expect(config.allowedUsers.size).toBe(3);
      expect(config.allowedUsers.has('user1@example.com')).toBe(true);
      expect(config.allowedUsers.has('user2@example.com')).toBe(true);
      expect(config.allowedUsers.has('user3@example.com')).toBe(true);
    });

    it('should normalize email addresses to lowercase', () => {
      process.env.ALLOWED_USERS = 'User@Example.COM,ADMIN@TEST.COM';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(true);
      expect(config.allowedUsers.size).toBe(2);
      expect(config.allowedUsers.has('user@example.com')).toBe(true);
      expect(config.allowedUsers.has('admin@test.com')).toBe(true);
    });

    it('should trim whitespace from email addresses', () => {
      process.env.ALLOWED_USERS = '  user1@example.com  ,  user2@example.com  ';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(true);
      expect(config.allowedUsers.size).toBe(2);
      expect(config.allowedUsers.has('user1@example.com')).toBe(true);
      expect(config.allowedUsers.has('user2@example.com')).toBe(true);
    });

    it('should filter out empty entries', () => {
      process.env.ALLOWED_USERS = 'user@example.com,,,admin@example.com';

      const config = loadAllowlistConfig();

      expect(config.enabled).toBe(true);
      expect(config.allowedUsers.size).toBe(2);
    });
  });

  describe('isUserAllowed', () => {
    it('should allow all users when allowlist is disabled', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      expect(isUserAllowed('anyone@example.com', config)).toBe(true);
      expect(isUserAllowed('random@test.com', config)).toBe(true);
      expect(isUserAllowed(undefined, config)).toBe(true);
    });

    it('should deny access when no email provided and allowlist enabled', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      expect(isUserAllowed(undefined, config)).toBe(false);
      expect(isUserAllowed('', config)).toBe(false);
    });

    it('should allow users on the allowlist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user1@example.com', 'user2@example.com'])
      };

      expect(isUserAllowed('user1@example.com', config)).toBe(true);
      expect(isUserAllowed('user2@example.com', config)).toBe(true);
    });

    it('should deny users not on the allowlist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user1@example.com', 'user2@example.com'])
      };

      expect(isUserAllowed('user3@example.com', config)).toBe(false);
      expect(isUserAllowed('hacker@evil.com', config)).toBe(false);
    });

    it('should be case-insensitive for email matching', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      expect(isUserAllowed('User@Example.COM', config)).toBe(true);
      expect(isUserAllowed('USER@EXAMPLE.COM', config)).toBe(true);
    });
  });

  describe('checkAllowlistAuthorization', () => {
    it('should return undefined when user is allowed', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      expect(checkAllowlistAuthorization('user@example.com', config)).toBeUndefined();
    });

    it('should return error message when allowlist enabled and no email', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      const error = checkAllowlistAuthorization(undefined, config);
      expect(error).toBeDefined();
      expect(error).toContain('Authentication required');
    });

    it('should return error message when user not on allowlist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      const error = checkAllowlistAuthorization('unauthorized@example.com', config);
      expect(error).toBeDefined();
      expect(error).toContain('Access denied');
      expect(error).toContain('unauthorized@example.com');
    });

    it('should return undefined when allowlist disabled', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      expect(checkAllowlistAuthorization('anyone@example.com', config)).toBeUndefined();
    });
  });

  describe('addUserToAllowlist', () => {
    it('should add user to allowlist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['existing@example.com'])
      };

      const added = addUserToAllowlist('newuser@example.com', config);

      expect(added).toBe(true);
      expect(config.allowedUsers.has('newuser@example.com')).toBe(true);
      expect(config.allowedUsers.size).toBe(2);
    });

    it('should normalize email to lowercase when adding', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      addUserToAllowlist('NewUser@Example.COM', config);

      expect(config.allowedUsers.has('newuser@example.com')).toBe(true);
    });

    it('should return false if user already exists', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['existing@example.com'])
      };

      const added = addUserToAllowlist('existing@example.com', config);

      expect(added).toBe(false);
      expect(config.allowedUsers.size).toBe(1);
    });

    it('should enable allowlist when adding first user', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      addUserToAllowlist('user@example.com', config);

      expect(config.enabled).toBe(true);
    });
  });

  describe('removeUserFromAllowlist', () => {
    it('should remove user from allowlist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user1@example.com', 'user2@example.com'])
      };

      const removed = removeUserFromAllowlist('user1@example.com', config);

      expect(removed).toBe(true);
      expect(config.allowedUsers.has('user1@example.com')).toBe(false);
      expect(config.allowedUsers.size).toBe(1);
    });

    it('should normalize email to lowercase when removing', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      const removed = removeUserFromAllowlist('User@Example.COM', config);

      expect(removed).toBe(true);
      expect(config.allowedUsers.size).toBe(0);
    });

    it('should return false if user does not exist', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user@example.com'])
      };

      const removed = removeUserFromAllowlist('nonexistent@example.com', config);

      expect(removed).toBe(false);
      expect(config.allowedUsers.size).toBe(1);
    });
  });

  describe('getAllowedUsers', () => {
    it('should return sorted list of allowed users', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['zebra@example.com', 'alpha@example.com', 'beta@example.com'])
      };

      const users = getAllowedUsers(config);

      expect(users).toEqual(['alpha@example.com', 'beta@example.com', 'zebra@example.com']);
    });

    it('should return empty array when no users', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      const users = getAllowedUsers(config);

      expect(users).toEqual([]);
    });
  });

  describe('getAllowlistStats', () => {
    it('should return stats when allowlist enabled', () => {
      const config: AllowlistConfig = {
        enabled: true,
        allowedUsers: new Set(['user1@example.com', 'user2@example.com', 'user3@example.com'])
      };

      const stats = getAllowlistStats(config);

      expect(stats.enabled).toBe(true);
      expect(stats.userCount).toBe(3);
      expect(stats.users).toBeDefined();
      expect(stats.users).toHaveLength(3);
    });

    it('should not include user list when allowlist disabled', () => {
      const config: AllowlistConfig = {
        enabled: false,
        allowedUsers: new Set()
      };

      const stats = getAllowlistStats(config);

      expect(stats.enabled).toBe(false);
      expect(stats.userCount).toBe(0);
      expect(stats.users).toBeUndefined();
    });
  });
});
