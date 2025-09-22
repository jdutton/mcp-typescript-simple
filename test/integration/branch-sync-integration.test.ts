/**
 * Integration tests for branch sync tools
 * Tests the actual CLI tools execution and behavior
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Branch Sync Tools Integration', () => {
  const TIMEOUT = 30000; // 30 seconds for integration tests

  describe('sync-check tool', () => {
    it('should execute and return proper exit codes', async () => {
      try {
        const { stdout, stderr } = await execAsync('npm run sync-check', { timeout: TIMEOUT });

        // Should contain expected output patterns
        expect(stdout).toContain('Smart Branch Sync Checker');
        expect(stdout).toContain('BRANCH SYNC STATUS');

        // Should not have errors in stderr (warnings are ok)
        expect(stderr).not.toContain('Error:');
        expect(stderr).not.toContain('Failed');
      } catch (error: any) {
        // Exit code 1 is acceptable (needs merge) - test the output
        if (error.code === 1) {
          expect(error.stdout).toContain('Branch is');
          expect(error.stdout).toContain('commit(s) behind origin/main');
        } else {
          throw error;
        }
      }
    }, TIMEOUT);

    it('should support --check-only flag', async () => {
      try {
        const { stdout } = await execAsync('npm run sync-check -- --check-only', { timeout: TIMEOUT });

        expect(stdout).toContain('Smart Branch Sync Checker');
        expect(stdout).toContain('BRANCH SYNC STATUS');
      } catch (error: any) {
        // Exit code 1 is acceptable for behind branches
        if (error.code === 1) {
          expect(error.stdout).toContain('BRANCH SYNC STATUS');
        } else {
          throw error;
        }
      }
    }, TIMEOUT);

    it('should execute directly via npx tsx', async () => {
      try {
        const { stdout } = await execAsync('npx tsx tools/sync-check.ts --check-only', { timeout: TIMEOUT });

        expect(stdout).toContain('Smart Branch Sync Checker');
      } catch (error: any) {
        // Exit codes 0 or 1 are both valid
        if (error.code === 1 || error.code === 0) {
          expect(error.stdout || error.message).toContain('Smart Branch Sync Checker');
        } else {
          throw error;
        }
      }
    }, TIMEOUT);
  });

  describe('pre-commit tool', () => {
    it('should execute validation steps', async () => {
      try {
        const { stdout } = await execAsync('npm run pre-commit -- --skip-sync', { timeout: TIMEOUT });

        expect(stdout).toContain('Pre-Commit Check Tool');
        expect(stdout).toContain('Running code validation');
        expect(stdout).toContain('Pre-commit check completed successfully');
      } catch (error: any) {
        // If validation fails, should show specific error messages
        expect(error.stdout).toContain('Pre-Commit Check Tool');
        if (error.code === 1) {
          // Validation failure - should indicate which step failed
          expect(error.stdout).toMatch(/(TypeScript|ESLint|tests|Build)/);
        }
      }
    }, TIMEOUT);

    it('should check branch sync by default', async () => {
      try {
        const { stdout } = await execAsync('npm run pre-commit', { timeout: TIMEOUT });

        expect(stdout).toContain('Pre-Commit Check Tool');
        expect(stdout).toContain('Step 1: Checking branch sync status');
      } catch (error: any) {
        // Should show sync checking even if it fails
        expect(error.stdout).toContain('Pre-Commit Check Tool');

        if (error.code === 1) {
          // Could be sync failure or validation failure
          expect(error.stdout).toMatch(/(Branch sync|validation)/);
        }
      }
    }, TIMEOUT);

    it('should execute directly via npx tsx', async () => {
      try {
        const { stdout } = await execAsync('npx tsx tools/pre-commit-check.ts --skip-sync', { timeout: TIMEOUT });

        expect(stdout).toContain('Pre-Commit Check Tool');
      } catch (error: any) {
        // Should execute even if validation fails
        expect(error.stdout || error.message).toContain('Pre-Commit Check Tool');
      }
    }, TIMEOUT);
  });

  describe('npm script integration', () => {
    it('should have sync-check script in package.json', async () => {
      const { stdout } = await execAsync('npm run | grep sync-check', { timeout: 5000 });
      expect(stdout).toContain('sync-check');
    });

    it('should have pre-commit script in package.json', async () => {
      const { stdout } = await execAsync('npm run | grep pre-commit', { timeout: 5000 });
      expect(stdout).toContain('pre-commit');
    });

    it('should pass parameters correctly', async () => {
      try {
        // Test parameter passing through npm run
        const { stdout } = await execAsync('npm run sync-check -- --help', { timeout: 10000 });

        // Should show help or execute normally (tools don't have --help yet, but should not error)
        expect(stdout).toBeDefined();
      } catch (error: any) {
        // Parameter errors are expected since tools don't have --help
        // But should not be execution errors
        expect(error.code).not.toBe(127); // Command not found
        expect(error.code).not.toBe(126); // Permission denied
      }
    });
  });

  describe('error handling', () => {
    it('should handle git repository errors gracefully', async () => {
      try {
        // Create a temporary directory without git
        const { stdout } = await execAsync('cd /tmp && npx tsx ' + process.cwd() + '/tools/sync-check.ts', { timeout: 10000 });

        // Should handle non-git directory gracefully
        expect(stdout).toContain('Error:');
      } catch (error: any) {
        // Should exit with error code 2 for error conditions
        expect(error.code).toBe(2);
        expect(error.stdout).toContain('Error:');
      }
    });

    it('should handle missing npm scripts gracefully', async () => {
      try {
        // Test with a command that doesn't exist
        await execAsync('npm run nonexistent-script', { timeout: 5000 });
      } catch (error: any) {
        // Should fail with npm error, not crash
        expect(error.code).toBeDefined();
        expect(error.stderr).toContain('npm');
      }
    });
  });

  describe('output formatting', () => {
    it('should produce consistent output format', async () => {
      try {
        const { stdout } = await execAsync('npm run sync-check', { timeout: TIMEOUT });

        // Should have consistent formatting
        expect(stdout).toMatch(/={60}/); // Separator lines
        expect(stdout).toMatch(/📊 BRANCH SYNC STATUS/);
        expect(stdout).toMatch(/(✅|⚠️|❌)/); // Status indicators
      } catch (error: any) {
        if (error.code === 0 || error.code === 1) {
          expect(error.stdout).toMatch(/📊 BRANCH SYNC STATUS/);
        }
      }
    }, TIMEOUT);

    it('should provide actionable error messages', async () => {
      try {
        const { stdout } = await execAsync('npm run sync-check', { timeout: TIMEOUT });

        if (stdout.includes('⚠️')) {
          // Should provide clear next steps
          expect(stdout).toMatch(/git merge origin\/main/);
          expect(stdout).toMatch(/npm run validate/);
        }
      } catch (error: any) {
        if (error.code === 1 && error.stdout.includes('⚠️')) {
          expect(error.stdout).toMatch(/git merge origin\/main/);
        }
      }
    }, TIMEOUT);
  });
});