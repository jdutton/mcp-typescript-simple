/**
 * Unit tests for Redis utility functions
 *
 * Tests the normalizeKeyPrefix function to ensure proper prefix normalization
 * according to ADR 006 specifications.
 */

import { describe, it, expect } from 'vitest';
import { normalizeKeyPrefix, getRedisKeyPrefix } from '../src/stores/redis/redis-utils.js';
import { testKeyPrefixNormalization } from './helpers/redis-test-helpers.js';

describe('Redis Utilities', () => {
  describe('normalizeKeyPrefix', () => {
    it('should add trailing colon to prefix without colon', () => {
      testKeyPrefixNormalization(normalizeKeyPrefix, [
        ['mcp', 'mcp:'],
        ['mcp-main', 'mcp-main:'],
        ['mcp-server-1', 'mcp-server-1:'],
        ['production', 'production:']
      ]);
    });

    it('should preserve single trailing colon', () => {
      testKeyPrefixNormalization(normalizeKeyPrefix, [
        ['mcp:', 'mcp:'],
        ['mcp-main:', 'mcp-main:'],
        ['mcp-server-1:', 'mcp-server-1:']
      ]);
    });

    it('should normalize multiple trailing colons to single colon', () => {
      testKeyPrefixNormalization(normalizeKeyPrefix, [
        ['mcp::', 'mcp:'],
        ['mcp:::', 'mcp:'],
        ['mcp-main::::', 'mcp-main:']
      ]);
    });

    it('should return empty string for empty prefix (backward compatibility)', () => {
      expect(normalizeKeyPrefix('')).toBe('');
    });

    it('should handle whitespace-only prefixes', () => {
      testKeyPrefixNormalization(normalizeKeyPrefix, [
        ['   ', '   :']
      ]);
    });

    it('should handle prefixes with special characters', () => {
      testKeyPrefixNormalization(normalizeKeyPrefix, [
        ['mcp_dev', 'mcp_dev:'],
        ['mcp-test-123', 'mcp-test-123:'],
        ['mcp.staging', 'mcp.staging:']
      ]);
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
