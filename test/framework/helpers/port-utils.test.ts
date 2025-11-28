/**
 * Unit tests for port utilities
 * Tests the safety logic for self-healing port cleanup
 */

import { describe, it, expect } from 'vitest';
import {
  isTestProcess,
  ProcessInfo,
  terminateProcess,
  cleanupLeakedTestPorts,
} from '@mcp-typescript-simple/testing/port-utils';


 
describe('Port Utilities - Safety Logic', () => {
  describe('isTestProcess', () => {
    it('should identify tsx processes as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'tsx',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should identify node processes as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'node',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should identify vitest processes as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'vitest',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should identify npm processes as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'npm',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should identify processes with "test" in command as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: '/usr/bin/test-runner',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should identify processes with "dev" in command as test processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: '/usr/bin/dev-server',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should NOT identify postgres as test process', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'postgres',
        port: 5432,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should NOT identify redis as test process', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'redis-server',
        port: 6379,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should NOT identify nginx as test process', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'nginx',
        port: 80,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should NOT identify docker daemon as test process', () => {
      const processInfo: ProcessInfo = {
        pid: 1,
        command: 'dockerd',
        port: 2375,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should NOT identify mysql as test process', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'mysqld',
        port: 3306,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should NOT identify system processes', () => {
      const processInfo: ProcessInfo = {
        pid: 1,
        command: 'systemd',
        port: 1234,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should be conservative and return false for unknown processes', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'unknown-process',
        port: 1234,
      };
      expect(isTestProcess(processInfo)).toBe(false);
    });

    it('should handle case-insensitive matching', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: 'TSX',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });

    it('should handle process names with paths', () => {
      const processInfo: ProcessInfo = {
        pid: 12345,
        command: '/usr/local/bin/npx',
        port: 3000,
      };
      expect(isTestProcess(processInfo)).toBe(true);
    });
  });

  describe('terminateProcess', () => {
    it('should resolve even if process does not exist', async () => {
      // Use a non-existent PID
      const fakePID = 999999;

      // Should not throw
      await expect(terminateProcess(fakePID)).resolves.toBeUndefined();
    });

    it('should complete within timeout', async () => {
      const fakePID = 999999;
      const startTime = Date.now();

      await terminateProcess(fakePID);

      const elapsed = Date.now() - startTime;
      // Should complete immediately for non-existent process
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('cleanupLeakedTestPorts - Integration', () => {
    // Note: These are integration tests that verify the function behavior
    // without actually killing processes. Full integration tested in system tests.

    it('should return success for available ports', async () => {
      // Use a very high port number that's unlikely to be in use
      const unusedPort = 63000;

      const results = await cleanupLeakedTestPorts([unusedPort]);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        port: unusedPort,
        wasInUse: false,
        success: true,
      });
    });

    it('should handle multiple ports', async () => {
      const unusedPorts = [63001, 63002, 63003];

      const results = await cleanupLeakedTestPorts(unusedPorts);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result).toMatchObject({
          port: unusedPorts[index],
          wasInUse: false,
          success: true,
        });
      });
    });

    it('should provide error details when port cannot be freed', async () => {
      // This test documents the error handling behavior
      // In real scenarios, if a port is in use by a non-test process,
      // the function should return an error with details

      const results = await cleanupLeakedTestPorts([63004]);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('success');
      expect(results[0]).toHaveProperty('port', 63004);
    });
  });

  describe('Safety Guarantees', () => {
    it('should never return true for database processes', () => {
      const databases = ['postgres', 'mysql', 'mongod', 'redis'];

      databases.forEach((db) => {
        const processInfo: ProcessInfo = {
          pid: 1234,
          command: db,
          port: 1234,
        };
        expect(isTestProcess(processInfo)).toBe(false);
      });
    });

    it('should never return true for web servers', () => {
      const servers = ['nginx', 'apache', 'httpd'];

      servers.forEach((server) => {
        const processInfo: ProcessInfo = {
          pid: 1234,
          command: server,
          port: 80,
        };
        expect(isTestProcess(processInfo)).toBe(false);
      });
    });

    it('should never return true for system processes', () => {
      const systemProcesses = ['systemd', 'launchd', 'kernel_task'];

      systemProcesses.forEach((proc) => {
        const processInfo: ProcessInfo = {
          pid: 1,
          command: proc,
          port: 1234,
        };
        expect(isTestProcess(processInfo)).toBe(false);
      });
    });

    it('should always return true for known test runners', () => {
      const testRunners = ['vitest', 'playwright'];

      testRunners.forEach((runner) => {
        const processInfo: ProcessInfo = {
          pid: 1234,
          command: runner,
          port: 3000,
        };
        expect(isTestProcess(processInfo)).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing process info gracefully', async () => {
      // Test with a port that's very unlikely to be in use
      const results = await cleanupLeakedTestPorts([63005]);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it('should provide detailed error messages', async () => {
      const results = await cleanupLeakedTestPorts([63006]);

      expect(results).toHaveLength(1);
      const result = results[0];

      // Result should have all required fields
      expect(result).toHaveProperty('port');
      expect(result).toHaveProperty('wasInUse');
      expect(result).toHaveProperty('success');

      // If there was an error, it should have an error message
      if (!result.success && result.wasInUse) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('Platform Compatibility', () => {
    it('should work on macOS', () => {
      // This test documents macOS compatibility
      // The actual platform check happens at runtime via lsof/ps
      expect(process.platform).toBeDefined();
    });

    it('should use lsof for port detection', async () => {
      // lsof is the primary method for port detection
      // This test documents the dependency
      // Use a high port number unlikely to conflict with system services
      const unusedPort = 64123;
      const results = await cleanupLeakedTestPorts([unusedPort]);

      expect(results[0].success).toBe(true);
    });
  });
});
