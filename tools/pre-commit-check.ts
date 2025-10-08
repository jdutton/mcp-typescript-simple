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
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { BranchSyncChecker, type SyncCheckResult } from './sync-check.js';
import type { ValidationState } from './write-validation-state.js';

// Configuration for validation operations
const VALIDATION_TIMEOUT = 30000; // 30 seconds timeout for each validation step
const VALIDATION_STATE_FILE = '.validation-state.yaml';
const VALIDATION_MAX_AGE = 60 * 60 * 1000; // 1 hour

interface ValidationStateCheck {
  exists: boolean;
  isValid: boolean;
  matchesCurrentCode: boolean;
  timestamp?: Date;
  fullLogFile?: string;
  agentPrompt?: string;
}

class PreCommitChecker {
  private readonly skipSync: boolean;

  constructor(skipSync = false) {
    this.skipSync = skipSync;
  }

  /**
   * Run comprehensive pre-commit check workflow
   *
   * Performs branch sync checking and code validation.
   * Stops safely when manual intervention is needed.
   */
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

    // Step 2: Check validation state
    console.log('\n📍 Step 2: Checking validation state...');
    const validationState = this.checkValidationState();

    if (validationState.isValid && validationState.matchesCurrentCode) {
      // Validation state is current - skip full validation
      console.log('✅ Validation state is current - skipping full validation');
      console.log(`   Last validated: ${validationState.timestamp?.toLocaleString()}`);
      console.log('   ⚡ Fast pre-commit mode enabled');

      // Run only fast checks (typecheck + lint, no tests/build)
      console.log('\n📍 Step 3: Running fast pre-commit checks...');
      this.runFastChecks();
      console.log('✅ Fast pre-commit checks passed!');
    } else if (validationState.exists && !validationState.matchesCurrentCode) {
      // Validation state exists but is stale (code changed)
      console.log('⚠️  Validation state is STALE (code changed since validation)');
      if (validationState.fullLogFile) {
        console.log(`   Last log file: ${validationState.fullLogFile}`);
      }

      const isClaudeCode = this.isClaudeCodeContext();
      if (isClaudeCode && validationState.agentPrompt) {
        console.log('\n💡 CLAUDE CODE: Launch validation-fixer sub-agent');
        console.log('   Read .validation-state.yaml for ready-to-use agentPrompt');
      }

      console.log('\n❌ STOPPED: Run npm run validate first');
      console.log('   Validation state does not match current code');
      process.exit(1);
    } else {
      // No valid validation state - run full validation
      console.log('⚠️  No validation state found - running full validation...');
      console.log('\n📍 Step 3: Running code validation...');
      try {
        this.runValidation();
        console.log('✅ All validation checks passed!');
      } catch (error) {
        console.error('❌ Validation failed:', error);
        process.exit(1);
      }
    }

    // Step 4: Success
    console.log('\n🎉 Pre-commit check completed successfully!');
    console.log('✅ Branch is synced and code quality validated');
    console.log('🚀 Ready to commit and push changes');
  }

  /**
   * Check validation state file
   */
  private checkValidationState(): ValidationStateCheck {
    if (!existsSync(VALIDATION_STATE_FILE)) {
      return {
        exists: false,
        isValid: false,
        matchesCurrentCode: false
      };
    }

    try {
      const stateContent = readFileSync(VALIDATION_STATE_FILE, 'utf8');
      const state = yaml.load(stateContent) as ValidationState;

      // Check if validation passed
      if (!state.passed) {
        return {
          exists: true,
          isValid: false,
          matchesCurrentCode: false,
          fullLogFile: state.fullLogFile,
          agentPrompt: state.agentPrompt
        };
      }

      // Check if state is not too old (< 1 hour)
      const stateTimestamp = new Date(state.timestamp);
      const age = Date.now() - stateTimestamp.getTime();
      if (age > VALIDATION_MAX_AGE) {
        return {
          exists: true,
          isValid: false,
          matchesCurrentCode: false,
          timestamp: stateTimestamp
        };
      }

      // Check if git tree hash matches current code
      const currentTreeHash = this.getGitTreeHash();
      if (currentTreeHash !== state.treeHash) {
        return {
          exists: true,
          isValid: true, // Validation was valid when run
          matchesCurrentCode: false, // But code has changed since
          timestamp: stateTimestamp,
          fullLogFile: state.fullLogFile
        };
      }

      // All checks passed - state is current
      return {
        exists: true,
        isValid: true,
        matchesCurrentCode: true,
        timestamp: stateTimestamp
      };
    } catch (error) {
      console.warn('⚠️  Failed to read validation state:', error);
      return {
        exists: false,
        isValid: false,
        matchesCurrentCode: false
      };
    }
  }

  /**
   * Get working tree hash (includes staged + unstaged changes)
   */
  private getGitTreeHash(): string {
    try {
      // Use git stash create to include ALL working tree changes
      const stashHash = execSync('git stash create', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      // If no changes, fall back to HEAD tree
      if (!stashHash) {
        return execSync('git rev-parse HEAD^{tree}', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      }

      // Extract tree hash from stash commit
      return execSync(`git rev-parse ${stashHash}^{tree}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    } catch (error) {
      return `nogit-${Date.now()}`;
    }
  }

  /**
   * Run fast pre-commit checks (typecheck + lint only)
   */
  private runFastChecks(): void {
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
  }

  /**
   * Detect if running in Claude Code context
   */
  private isClaudeCodeContext(): boolean {
    return process.env.CLAUDE_CODE === 'true' ||
           process.env.TERM_PROGRAM === 'Claude' ||
           process.env.CLAUDE === 'true';
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
  const args: string[] = process.argv.slice(2);
  const skipSync: boolean = args.includes('--skip-sync') || args.includes('-s');

  const checker = new PreCommitChecker(skipSync);
  await checker.runPreCommitCheck();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1] as string}`) {
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(2);
  });
}

export { PreCommitChecker };