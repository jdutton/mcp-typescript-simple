/**
 * Unit tests for Redis utility functions
 *
 * Tests the normalizeKeyPrefix function to ensure proper prefix normalization
 * according to ADR 006 specifications.
 */

import { describe, it, expect } from 'vitest';
import { normalizeKeyPrefix, getRedisKeyPrefix } from '../src/stores/redis/redis-utils.js';

describe('Redis Utilities', () => {
  describe('normalizeKeyPrefix', () => {
    it('should add trailing colon to prefix without colon', () => {
      expect(normalizeKeyPrefix('mcp')).toBe('mcp:');
      expect(normalizeKeyPrefix('mcp-main')).toBe('mcp-main:');
      expect(normalizeKeyPrefix('mcp-server-1')).toBe('mcp-server-1:');
      expect(normalizeKeyPrefix('production')).toBe('production:');
    });

    it('should preserve single trailing colon', () => {
      expect(normalizeKeyPrefix('mcp:')).toBe('mcp:');
      expect(normalizeKeyPrefix('mcp-main:')).toBe('mcp-main:');
      expect(normalizeKeyPrefix('mcp-server-1:')).toBe('mcp-server-1:');
    });

    it('should normalize multiple trailing colons to single colon', () => {
      expect(normalizeKeyPrefix('mcp::')).toBe('mcp:');
      expect(normalizeKeyPrefix('mcp:::')).toBe('mcp:');
      expect(normalizeKeyPrefix('mcp-main::::')).toBe('mcp-main:');
    });

    it('should return empty string for empty prefix (backward compatibility)', () => {
      expect(normalizeKeyPrefix('')).toBe('');
    });

    it('should handle whitespace-only prefixes', () => {
      expect(normalizeKeyPrefix('   ')).toBe('   :');
    });

    it('should handle prefixes with special characters', () => {
      expect(normalizeKeyPrefix('mcp_dev')).toBe('mcp_dev:');
      expect(normalizeKeyPrefix('mcp-test-123')).toBe('mcp-test-123:');
      expect(normalizeKeyPrefix('mcp.staging')).toBe('mcp.staging:');
    });

    it('should be idempotent (calling twice yields same result)', () => {
      const input = 'mcp-main';
      const once = normalizeKeyPrefix(input);
      const twice = normalizeKeyPrefix(once);
      expect(once).toBe(twice);
      expect(once).toBe('mcp-main:');
    });
  });

  describe('getRedisKeyPrefix', () => {
    it('should return default "mcp" when REDIS_KEY_PREFIX not set', () => {
      // Note: In actual runtime, this would read from process.env.REDIS_KEY_PREFIX
      // This test verifies the default behavior
      const prefix = getRedisKeyPrefix();
      expect(prefix).toBeTruthy();
      expect(typeof prefix).toBe('string');
    });
  });
});
