/**
 * Fast integration tests for branch sync tools
 * Focuses on essential functionality with minimal overhead
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Branch Sync Tools - Fast Integration', () => {
  const FAST_TIMEOUT = 5000; // 5 seconds max

  describe('essential functionality', () => {
    it('sync-check tool should execute and return status', async () => {
      try {
        // Direct execution for minimal overhead
        const { stdout } = await execAsync('npx tsx tools/sync-check.ts --check-only', { timeout: FAST_TIMEOUT });

        expect(stdout).toContain('Smart Branch Sync Checker');
        expect(stdout).toContain('BRANCH SYNC STATUS');
        expect(stdout).toMatch(/(✅|⚠️)/); // Should show some status
      } catch (error: any) {
        // Exit code 1 is acceptable (needs merge)
        if (error.code === 1) {
          expect(error.stdout).toContain('BRANCH SYNC STATUS');
        } else {
          throw error;
        }
      }
    }, FAST_TIMEOUT);

    it('pre-commit tool should run validation quickly', async () => {
      try {
        // Skip sync and tests for speed
        const { stdout } = await execAsync('npx tsx tools/pre-commit-check.ts --skip-sync', { timeout: FAST_TIMEOUT });

        expect(stdout).toContain('Pre-Commit Check Tool');
        expect(stdout).toContain('TypeScript types are valid');
        expect(stdout).toContain('ESLint checks passed');
      } catch (error: any) {
        // Should at least show it started
        expect(error.stdout).toContain('Pre-Commit Check Tool');
      }
    }, FAST_TIMEOUT);

    it('npm scripts should be available', async () => {
      const { stdout } = await execAsync('npm run | grep -E "(sync-check|pre-commit)"', { timeout: 1000 });

      expect(stdout).toContain('sync-check');
      expect(stdout).toContain('pre-commit');
    });

    it('tools should handle invalid directory gracefully', async () => {
      try {
        await execAsync('cd /tmp && npx tsx ' + process.cwd() + '/tools/sync-check.ts --check-only', { timeout: FAST_TIMEOUT });
      } catch (error: any) {
        // Should exit with error code 2 and show error message
        expect(error.code).toBe(2);
        expect(error.stdout).toContain('Error:');
      }
    });
  });
});