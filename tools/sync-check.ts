#!/usr/bin/env tsx
/**
 * Smart Branch Sync Checker
 *
 * Safely checks if the current branch is behind origin/main without auto-merging.
 * Provides clear status reporting and next-step instructions for developers.
 *
 * Key safety features:
 * - Never auto-merges (preserves conflict visibility)
 * - Clear exit codes for Claude Code integration
 * - Explicit instructions when manual intervention needed
 * - Cross-platform compatibility
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SyncCheckResult {
  isUpToDate: boolean;
  behindBy: number;
  currentBranch: string;
  hasOriginMain: boolean;
  error?: string;
}

class BranchSyncChecker {
  private readonly checkOnly: boolean;

  constructor(checkOnly = false) {
    this.checkOnly = checkOnly;
  }

  async checkSync(): Promise<SyncCheckResult> {
    try {
      // Get current branch name
      const currentBranch = await this.getCurrentBranch();
      console.log(`📍 Current branch: ${currentBranch}`);

      // Check if origin/main exists
      const hasOriginMain = await this.hasOriginMain();
      if (!hasOriginMain) {
        return {
          isUpToDate: true,
          behindBy: 0,
          currentBranch,
          hasOriginMain: false,
          error: 'No origin/main remote found'
        };
      }

      // Fetch latest from origin/main
      console.log('🔄 Fetching latest changes from origin/main...');
      await this.fetchOriginMain();

      // Check how many commits behind
      const behindBy = await this.getCommitsBehind();

      const result: SyncCheckResult = {
        isUpToDate: behindBy === 0,
        behindBy,
        currentBranch,
        hasOriginMain: true
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isUpToDate: false,
        behindBy: -1,
        currentBranch: 'unknown',
        hasOriginMain: false,
        error: errorMessage
      };
    }
  }

  private async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD');
      return stdout.trim();
    } catch {
      throw new Error('Not in a git repository or unable to determine current branch');
    }
  }

  private async hasOriginMain(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --verify origin/main');
      return true;
    } catch {
      return false;
    }
  }

  private async fetchOriginMain(): Promise<void> {
    try {
      await execAsync('git fetch origin main');
    } catch (error) {
      throw new Error(`Failed to fetch from origin/main: ${error}`);
    }
  }

  private async getCommitsBehind(): Promise<number> {
    try {
      const { stdout } = await execAsync('git rev-list --count HEAD..origin/main');
      return parseInt(stdout.trim(), 10);
    } catch (error) {
      throw new Error(`Failed to check commits behind: ${error}`);
    }
  }

  printStatus(result: SyncCheckResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 BRANCH SYNC STATUS');
    console.log('='.repeat(60));

    if (result.error) {
      console.log(`❌ Error: ${result.error}`);
      return;
    }

    if (!result.hasOriginMain) {
      console.log('ℹ️  No origin/main remote found - likely a standalone repository');
      console.log('✅ No sync required');
      return;
    }

    if (result.isUpToDate) {
      console.log('✅ Branch is up to date with origin/main');
      console.log('🎯 Ready to proceed with development');
    } else {
      console.log(`⚠️  Branch is ${result.behindBy} commit(s) behind origin/main`);
      console.log('\n📋 REQUIRED ACTIONS:');
      console.log('1. Merge latest changes: git merge origin/main');
      console.log('2. Resolve any conflicts in your editor');
      console.log('3. Run validation: npm run validate');
      console.log('4. Continue with your development');

      if (!this.checkOnly) {
        console.log('\n💡 TIP: Use --check-only flag to just check status without instructions');
      }
    }

    console.log('='.repeat(60));
  }

  getExitCode(result: SyncCheckResult): number {
    if (result.error) return 2; // Error condition
    if (!result.hasOriginMain) return 0; // No remote, consider OK
    return result.isUpToDate ? 0 : 1; // 0 = up to date, 1 = needs merge
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check-only') || args.includes('-c');

  console.log('🔍 Smart Branch Sync Checker');
  console.log('Safety-first approach: checks status, never auto-merges\n');

  const checker = new BranchSyncChecker(checkOnly);
  const result = await checker.checkSync();

  checker.printStatus(result);

  const exitCode = checker.getExitCode(result);
  process.exit(exitCode);
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(2);
  });
}

export { BranchSyncChecker, type SyncCheckResult };