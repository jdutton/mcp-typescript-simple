#!/usr/bin/env tsx
/**
 * Pre-Commit Check Tool
 *
 * Comprehensive pre-commit workflow that combines branch sync checking
 * with validation. Stops safely when manual intervention is needed.
 *
 * Workflow:
 * 1. Check if branch is behind origin/main (never auto-merges)
 * 2. If behind, stop with clear instructions
 * 3. If up-to-date, proceed with full validation
 * 4. Provide clear success/failure signals for Claude Code
 */

import { execSync } from 'child_process';

// Configuration for validation operations
const VALIDATION_TIMEOUT = 30000; // 30 seconds timeout for each validation step
import { BranchSyncChecker, type SyncCheckResult } from './sync-check.js';

class PreCommitChecker {
  private readonly skipSync: boolean;

  constructor(skipSync = false) {
    this.skipSync = skipSync;
  }

  async runPreCommitCheck(): Promise<void> {
    console.log('🚀 Pre-Commit Check Tool');
    console.log('Ensuring branch sync and code quality before commit\n');

    // Step 1: Check branch sync (unless skipped)
    if (!this.skipSync) {
      console.log('📍 Step 1: Checking branch sync status...');
      const syncChecker = new BranchSyncChecker();
      const syncResult = await syncChecker.checkSync();

      if (syncResult.error) {
        console.error('❌ Branch sync check failed:', syncResult.error);
        process.exit(2);
      }

      if (!syncResult.isUpToDate && syncResult.hasOriginMain) {
        console.log('\n🛑 STOPPED: Branch sync required');
        console.log('Your branch is behind origin/main and needs manual merge.\n');

        console.log('📋 Required actions:');
        console.log('1. git merge origin/main');
        console.log('2. Resolve any conflicts');
        console.log('3. npm run pre-commit  (to continue)\n');

        console.log('💡 Or use: npm run pre-commit -- --skip-sync (to skip sync check)');
        process.exit(1);
      }

      if (syncResult.isUpToDate) {
        console.log('✅ Branch is up to date with origin/main');
      } else {
        console.log('ℹ️  No origin/main remote - proceeding with validation');
      }
    } else {
      console.log('⏭️  Skipping branch sync check (--skip-sync flag used)');
    }

    // Step 2: Run validation
    console.log('\n📍 Step 2: Running code validation...');
    try {
      this.runValidation();
      console.log('✅ All validation checks passed!');
    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    }

    // Step 3: Success
    console.log('\n🎉 Pre-commit check completed successfully!');
    console.log('✅ Branch is synced and code quality validated');
    console.log('🚀 Ready to commit and push changes');
  }

  private runValidation(): void {
    console.log('🔍 Running TypeScript type checking...');
    try {
      execSync('npm run typecheck', { stdio: 'pipe', timeout: VALIDATION_TIMEOUT });
      console.log('  ✅ TypeScript types are valid');
    } catch (error) {
      console.error('  ❌ TypeScript type errors found');
      throw new Error('Type checking failed');
    }

    console.log('🔍 Running ESLint code checking...');
    try {
      execSync('npm run lint', { stdio: 'pipe', timeout: VALIDATION_TIMEOUT });
      console.log('  ✅ ESLint checks passed');
    } catch (error) {
      console.error('  ❌ ESLint errors found');
      throw new Error('Linting failed');
    }

    // Skip unit tests in pre-commit for speed - they run in CI/CD
    console.log('  ⏭️  Skipping unit tests (run in CI/CD)');
    console.log('  💡 To run tests manually: npm run test:unit');

    console.log('🔍 Building project...');
    try {
      execSync('npm run build', { stdio: 'pipe', timeout: VALIDATION_TIMEOUT });
      console.log('  ✅ Build successful');
    } catch (error) {
      console.error('  ❌ Build failed');
      throw new Error('Build failed');
    }

    // Skip integration tests in pre-commit for speed
    // Integration tests will run in CI/CD pipeline
    console.log('  ⏭️  Skipping integration tests (run in CI/CD)');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipSync = args.includes('--skip-sync') || args.includes('-s');

  const checker = new PreCommitChecker(skipSync);
  await checker.runPreCommitCheck();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(2);
  });
}

export { PreCommitChecker };