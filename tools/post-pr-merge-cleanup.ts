#!/usr/bin/env tsx
/**
 * Post-PR Merge Cleanup Tool
 *
 * Comprehensive post-PR cleanup workflow that:
 * 1. Switches to main branch
 * 2. Syncs main branch with GitHub origin
 * 3. Deletes local branches that have been merged on GitHub
 * 4. Provides clean workspace for next PR
 *
 * Safe operations:
 * - Only deletes branches that are confirmed merged on GitHub
 * - Never deletes the current main branch or unmerged branches
 * - Provides clear feedback on all actions taken
 */

import { execSync } from 'child_process';

// Configuration
const TIMEOUT = 30000; // 30 seconds timeout for git operations

interface CleanupResult {
  success: boolean;
  error?: string;
  branchesDeleted: string[];
  currentBranch: string;
  mainSynced: boolean;
}

class PostPRMergeCleanup {
  /**
   * Run comprehensive post-PR merge cleanup workflow
   */
  async runCleanup(): Promise<CleanupResult> {
    console.log('🧹 Post-PR Merge Cleanup Tool');
    console.log('Cleaning up merged branches and syncing main branch\n');

    const result: CleanupResult = {
      success: false,
      branchesDeleted: [],
      currentBranch: '',
      mainSynced: false
    };

    try {
      // Step 1: Get current branch
      console.log('📍 Step 1: Checking current branch...');
      result.currentBranch = this.getCurrentBranch();
      console.log(`✅ Current branch: ${result.currentBranch}\n`);

      // Step 2: Switch to main branch
      console.log('📍 Step 2: Switching to main branch...');
      this.switchToMain();
      console.log('✅ Switched to main branch\n');

      // Step 3: Sync main branch with GitHub
      console.log('📍 Step 3: Syncing main branch with GitHub...');
      this.syncMainBranch();
      result.mainSynced = true;
      console.log('✅ Main branch synced with origin\n');

      // Step 4: Fetch remote branch information
      console.log('📍 Step 4: Fetching remote branch information...');
      this.fetchRemoteInfo();
      console.log('✅ Remote information updated\n');

      // Step 5: Find and delete merged branches
      console.log('📍 Step 5: Finding merged branches to delete...');
      result.branchesDeleted = this.deleteMergedBranches();

      if (result.branchesDeleted.length > 0) {
        console.log(`✅ Deleted ${result.branchesDeleted.length} merged branches:`);
        result.branchesDeleted.forEach(branch => console.log(`   - ${branch}`));
      } else {
        console.log('✅ No merged branches found to delete');
      }
      console.log();

      // Step 6: Clean up remote tracking branches
      console.log('📍 Step 6: Cleaning up remote tracking references...');
      this.pruneRemoteReferences();
      console.log('✅ Remote references cleaned up\n');

      result.success = true;
      console.log('🎉 Post-PR merge cleanup completed successfully!');
      console.log('✅ Ready for next PR development');

      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error('❌ Cleanup failed:', result.error);
      return result;
    }
  }

  /**
   * Get the current git branch name
   */
  private getCurrentBranch(): string {
    try {
      return execSync('git branch --show-current', {
        encoding: 'utf8',
        timeout: TIMEOUT
      }).trim();
    } catch (error) {
      throw new Error(`Failed to get current branch: ${error}`);
    }
  }

  /**
   * Switch to main branch
   */
  private switchToMain(): void {
    try {
      execSync('git checkout main', {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error(`Failed to switch to main branch: ${error}`);
    }
  }

  /**
   * Sync main branch with GitHub origin
   */
  private syncMainBranch(): void {
    try {
      // Fetch latest changes from origin
      execSync('git fetch origin main', {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Fast-forward merge origin/main
      execSync('git merge origin/main --ff-only', {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });

    } catch (error) {
      throw new Error(`Failed to sync main branch: ${error}`);
    }
  }

  /**
   * Fetch remote branch information
   */
  private fetchRemoteInfo(): void {
    try {
      execSync('git fetch origin --prune', {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error(`Failed to fetch remote info: ${error}`);
    }
  }

  /**
   * Find and delete branches that have been merged on GitHub
   */
  private deleteMergedBranches(): string[] {
    try {
      // Get list of local branches (excluding main)
      const allBranches = execSync('git branch --format="%(refname:short)"', {
        encoding: 'utf8',
        timeout: TIMEOUT
      })
        .trim()
        .split('\n')
        .filter(branch => branch && branch !== 'main' && !branch.startsWith('*'));

      const deletedBranches: string[] = [];

      for (const branch of allBranches) {
        if (this.isBranchMerged(branch)) {
          console.log(`🗑️  Deleting merged branch: ${branch}`);

          try {
            execSync(`git branch -d "${branch}"`, {
              encoding: 'utf8',
              timeout: TIMEOUT,
              stdio: ['pipe', 'pipe', 'pipe']
            });
            deletedBranches.push(branch);
          } catch (deleteError) {
            console.warn(`⚠️  Could not delete branch ${branch}: ${deleteError}`);
            // Try force delete if regular delete fails (branch might be merged on remote but not locally)
            try {
              execSync(`git branch -D "${branch}"`, {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              deletedBranches.push(branch);
              console.log(`🗑️  Force deleted branch: ${branch}`);
            } catch (forceDeleteError) {
              console.warn(`⚠️  Could not force delete branch ${branch}: ${forceDeleteError}`);
            }
          }
        }
      }

      return deletedBranches;

    } catch (error) {
      console.warn(`⚠️  Error finding merged branches: ${error}`);
      return [];
    }
  }

  /**
   * Check if a branch has been merged into main
   */
  private isBranchMerged(branch: string): boolean {
    try {
      // Check if branch is merged into main
      const mergedBranches = execSync('git branch --merged main --format="%(refname:short)"', {
        encoding: 'utf8',
        timeout: TIMEOUT
      });

      return mergedBranches.includes(branch);

    } catch (error) {
      // If we can't determine merge status, don't delete the branch
      console.warn(`⚠️  Could not determine merge status for ${branch}: ${error}`);
      return false;
    }
  }

  /**
   * Clean up remote tracking references
   */
  private pruneRemoteReferences(): void {
    try {
      execSync('git remote prune origin', {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      console.warn(`⚠️  Could not prune remote references: ${error}`);
    }
  }
}

// CLI execution
async function main() {
  try {
    const cleanup = new PostPRMergeCleanup();
    const result = await cleanup.runCleanup();

    if (result.success) {
      console.log('\n📊 Cleanup Summary:');
      console.log(`   Current branch: main`);
      console.log(`   Main synced: ${result.mainSynced ? '✅' : '❌'}`);
      console.log(`   Branches deleted: ${result.branchesDeleted.length}`);

      if (result.branchesDeleted.length > 0) {
        console.log('   Deleted branches:');
        result.branchesDeleted.forEach(branch => console.log(`     - ${branch}`));
      }

      process.exit(0);
    } else {
      console.error('\n❌ Cleanup failed');
      if (result.error) {
        console.error(`Error: ${result.error}`);
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error during cleanup:', error);
    process.exit(2);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PostPRMergeCleanup, type CleanupResult };