#!/usr/bin/env tsx
/**
 * Validation State Writer
 *
 * Captures validation results and writes state file for pre-commit checking.
 * Runs automatically after `npm run validate` via postvalidate hook.
 *
 * Features:
 * - Captures git tree hash for exact code state verification
 * - Embeds failed step output directly in YAML (no log file reading needed)
 * - Saves full validation output to /tmp for emergency debugging only
 * - Parses errors by category (TypeScript, ESLint, tests, build)
 * - Provides context-aware guidance (Claude Code vs manual)
 * - Cleans up old log files (>7 days)
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

interface PhaseResult {
  name: string;
  duration: number;  // milliseconds
  passed: boolean;
  steps: { name: string; passed: boolean; duration: number }[];
  output?: string;   // Only if phase failed
}

interface ValidationState {
  // Validation result
  passed: boolean;
  timestamp: string;
  treeHash: string;

  // Phase results (timing and status)
  phases?: PhaseResult[];

  // Failed step details (only if failed)
  failedStep?: string;
  rerunCommand?: string;
  failedTests?: string[];
  failedStepOutput?: string;

  // Full log file (always present - includes ALL validation output)
  fullLogFile?: string;

  // Quick summary for humans/LLMs
  summary?: string;

  // Agent prompt for validation-fixer
  agentPrompt?: string;
}

interface ErrorSummary {
  typescript: number;
  eslint: number;
  testFailures: number;
  buildErrors: number;
  total: number;
}

class ValidationStateWriter {
  private readonly stateFile = '.validate-state.yaml';
  private readonly logDir = '/tmp';
  private readonly logPrefix = 'mcp-validation-';
  private readonly maxLogAge = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Write validation state with captured results
   */
  async writeStateWithResults(
    validationPassed: boolean,
    logFile: string | null,
    output: string,
    quietMode: boolean = false,
    failedStep?: string,
    rerunCommand?: string,
    failedStepOutput?: string,
    phases?: PhaseResult[]
  ): Promise<void> {
    const startTime = Date.now();

    if (!quietMode) {
      console.log('\n📝 Writing validation state...');
    }

    // Get git tree hash (cryptographic hash of current code state)
    const treeHash = this.getGitTreeHash();
    if (!quietMode) {
      console.log(`   Git tree hash: ${treeHash.substring(0, 12)}...`);
    }

    const timestamp = new Date().toISOString();

    // Parse failed tests from failed step output
    const failedTests = failedStepOutput ? this.parseFailedTests(failedStepOutput) : undefined;

    // Create state object
    const state: ValidationState = {
      passed: validationPassed,
      timestamp,
      treeHash,
      fullLogFile: logFile || undefined,  // ALWAYS include log file path
      phases,  // Include phase timing information
      summary: this.generateSummary(validationPassed, failedStep, failedTests),
      agentPrompt: validationPassed ? undefined : this.generateAgentPrompt(failedStep, rerunCommand),
    };

    // Add failure details if validation failed
    if (!validationPassed && failedStep) {
      state.failedStep = failedStep;
      state.rerunCommand = rerunCommand;
      state.failedTests = failedTests;
      state.failedStepOutput = failedStepOutput;
    }

    // Write YAML with custom formatting
    const yamlOutput = this.formatYAML(state);
    writeFileSync(this.stateFile, yamlOutput);

    // Clean up old log files (silent)
    this.cleanupOldLogs();

    // Only show guidance if not in quiet mode
    if (!quietMode) {
      this.showGuidance(state);
    }

    if (!quietMode) {
      console.log(`✅ Validation state written to ${this.stateFile}`);
    }
  }

  /**
   * Write validation state after npm run validate completes (legacy - for postvalidate hook)
   */
  async writeState(): Promise<void> {
    // This is now a fallback - the wrapper script should be used instead
    await this.writeStateWithResults(
      process.exitCode === 0,
      null,
      ''
    );
  }

  /**
   * Get working tree hash (includes staged + unstaged + untracked changes)
   *
   * IMPORTANT: git write-tree only looks at the staging area, NOT working tree changes!
   * We need to include unstaged modifications and untracked files for accurate state tracking.
   */
  private getGitTreeHash(): string {
    try {
      // Use git stash create to get a hash that includes ALL working tree changes:
      // - Staged changes (index)
      // - Unstaged changes (working tree modifications)
      // - Untracked files (with -u flag)
      // This creates a temporary commit object without actually stashing
      const stashHash = execSync('git stash create', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      // If no changes, git stash create returns empty string
      // Fall back to HEAD tree in this case
      if (!stashHash) {
        const headTree = execSync('git rev-parse HEAD^{tree}', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        return headTree;
      }

      // Extract tree hash from stash commit (commit hash changes due to timestamp)
      const treeHash = execSync(`git rev-parse ${stashHash}^{tree}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      return treeHash;
    } catch (error) {
      // Fallback: use hash of all file mtimes if not in git repo
      console.warn('   ⚠️  Not in git repo, using timestamp-based hash');
      return `nogit-${Date.now()}`;
    }
  }

  /**
   * Get log file path for this validation run
   */
  private getLogFilePath(timestamp: number): string {
    const date = new Date(timestamp);
    const dateStr = date.toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
    return join(this.logDir, `${this.logPrefix}${dateStr}-${timeStr}.log`);
  }

  /**
   * Parse failed tests from test output
   */
  private parseFailedTests(output: string): string[] {
    const failures: string[] = [];

    // Jest test failures - extract test names (filter out console log noise)
    const jestFailures = output.match(/● .+/g);
    if (jestFailures) {
      const realFailures = jestFailures
        .filter(line => {
          // Filter out console log lines and other noise
          const trimmed = line.trim();
          return !trimmed.startsWith('● Console') &&
                 trimmed.length > 10 && // Ignore very short lines
                 trimmed.includes('›'); // Real test names have suite separator
        })
        .slice(0, 20); // Limit to first 20
      failures.push(...realFailures);
    }

    // TypeScript errors - extract file:line
    const tsErrors = output.match(/[^(]+\(\d+,\d+\): error TS\d+:.+/g);
    if (tsErrors) {
      failures.push(...tsErrors.slice(0, 20).map(e => e.trim()));
    }

    // ESLint errors - extract file:line
    const eslintErrors = output.match(/\S+\.ts\(\d+,\d+\): .+/g);
    if (eslintErrors) {
      failures.push(...eslintErrors.slice(0, 20).map(e => e.trim()));
    }

    return failures;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(passed: boolean, failedStep?: string, failedTests?: string[]): string {
    if (passed) {
      return '✅ All validation steps passed';
    }

    const testCount = failedTests?.length || 0;
    return `❌ Validation failed at: ${failedStep} (${testCount} failures)`;
  }

  /**
   * Generate agent prompt for validation-fixer sub-agent
   */
  private generateAgentPrompt(failedStep?: string, rerunCommand?: string): string | null {
    if (!failedStep) {
      return null; // Validation passed, no fixes needed
    }

    return `Fix failures in "${failedStep}". Read .validate-state.yaml for test failures and output. Fix issues, then run: ${rerunCommand || 'npm run validate'}`;
  }

  /**
   * Format ValidationState as YAML with helpful comments
   */
  private formatYAML(state: ValidationState): string {
    let output = '# Summary of npm run validate\n';

    if (state.passed) {
      // Minimal header for passing validation
      output += '# Read "summary" field for result\n';
    } else {
      // More detailed guidance only on failure
      output += '# On failure: Read "failedStepOutput" for errors, then run "rerunCommand"\n';
    }
    output += '\n';

    // Basic info
    output += `passed: ${state.passed}\n`;
    output += `timestamp: ${state.timestamp}\n`;
    output += `treeHash: ${state.treeHash}\n`;
    output += `summary: ${JSON.stringify(state.summary)}\n`;

    // Always show log file path (single line, no extra comment)
    if (state.fullLogFile) {
      output += `fullLogFile: ${JSON.stringify(state.fullLogFile)}\n`;
    }

    // Only add failure details if validation failed
    if (!state.passed && state.failedStep) {
      output += `\n# Failed Step\n`;
      output += `failedStep: ${JSON.stringify(state.failedStep)}\n`;
      output += `rerunCommand: ${JSON.stringify(state.rerunCommand)}\n`;

      if (state.failedTests && state.failedTests.length > 0) {
        output += `\n# Failed Tests (first ${state.failedTests.length})\n`;
        output += `failedTests:\n`;
        state.failedTests.forEach(test => {
          output += `  - ${JSON.stringify(test)}\n`;
        });
      }

      if (state.agentPrompt) {
        output += `\n# For LLM agents\n`;
        output += `agentPrompt: ${JSON.stringify(state.agentPrompt)}\n`;
      }

      if (state.failedStepOutput) {
        output += `\n# Error Output\n`;
        output += `failedStepOutput: |\n`;
        // Indent each line with 2 spaces for YAML literal block
        const lines = state.failedStepOutput.split('\n');
        lines.forEach(line => {
          output += `  ${line}\n`;
        });
      }
    }

    return output;
  }

  /**
   * Clean up log files older than maxLogAge
   */
  private cleanupOldLogs(): void {
    try {
      const now = Date.now();
      const files = readdirSync(this.logDir);

      let cleaned = 0;
      for (const file of files) {
        if (file.startsWith(this.logPrefix)) {
          const filePath = join(this.logDir, file);
          const stats = statSync(filePath);
          const age = now - stats.mtimeMs;

          if (age > this.maxLogAge) {
            unlinkSync(filePath);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        console.log(`   🧹 Cleaned up ${cleaned} old log file(s) (>7 days)`);
      }
    } catch (error) {
      // Ignore cleanup errors (not critical)
    }
  }

  /**
   * Show context-aware guidance based on validation result
   */
  private showGuidance(state: ValidationState): void {
    console.log('\n' + '='.repeat(60));

    if (state.passed) {
      console.log('✅ VALIDATION PASSED');
      console.log('='.repeat(60));
      console.log('\n🚀 Ready to commit!');
      console.log('   Run: npm run pre-commit');
      return;
    }

    // Validation failed
    console.log('❌ VALIDATION FAILED');
    console.log('='.repeat(60));

    console.log(`\n📝 Validation state: .validate-state.yaml`);
    console.log('   → Read this file for error details (embedded in YAML)');

    if (state.fullLogFile) {
      console.log(`\n📋 Full log file: ${state.fullLogFile}`);
      console.log('   → Emergency use only (very large, avoid reading)');
    }

    // Detect if running in Claude Code
    const isClaudeCode = this.isClaudeCodeContext();

    if (isClaudeCode) {
      console.log('\n💡 CLAUDE CODE: Read .validate-state.yaml');
      console.log('   The file contains:');
      console.log('   - Failed step name and rerun command');
      console.log('   - List of failed tests');
      console.log('   - Complete output from failed step');
      console.log('   - Agent prompt for validation-fixer\n');
      console.log('   Just read .validate-state.yaml - no need to search logs!');
    } else {
      console.log('\n💡 MANUAL: Fix errors and re-run validation');
      console.log('   Read: .validate-state.yaml (contains error details)');
      console.log('   After fixing: npm run validate');
    }

    console.log('='.repeat(60));
  }

  /**
   * Detect if running in Claude Code context
   */
  private isClaudeCodeContext(): boolean {
    return process.env.CLAUDE_CODE === 'true' ||
           process.env.TERM_PROGRAM === 'Claude' ||
           process.env.CLAUDE === 'true';
  }
}

async function main(): Promise<void> {
  const writer = new ValidationStateWriter();
  await writer.writeState();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1] as string}`) {
  main().catch((error) => {
    console.error('❌ Failed to write validation state:', error);
    process.exit(1);
  });
}

export { ValidationStateWriter, ValidationState, ErrorSummary, PhaseResult };
