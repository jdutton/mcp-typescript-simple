/**
 * LLM-Friendly Vitest Reporter
 *
 * Supports two modes:
 * 1. Standard mode: Adds LLM summary after default reporter output
 * 2. LLM mode (LLM_OUTPUT=1): Shows concise failure summaries only + suppresses pino logs
 *
 * Usage:
 *   npm run test:unit               # Standard mode (verbose + summary + logs)
 *   LLM_OUTPUT=1 npm run test:unit  # LLM mode (concise failures only, no logs)
 *   npm run validate                # Automatically uses LLM mode
 *
 * When LLM_OUTPUT=1 is set:
 * - Vitest reporter shows only concise failure summaries
 * - Pino logs are redirected to /dev/null (see src/observability/logger.ts)
 * - Full verbose logs still written to /tmp/mcp-validation-*.log for debugging
 *
 * Only applies to Vitest-based tests (test:unit). Integration tests (ci-test.ts)
 * and Playwright tests (test:system:headless) use different test runners.
 *
 * @extraction-target @agentic-workflow
 */

import type { File, Reporter, Task, Vitest } from 'vitest';

export default class LLMReporter implements Reporter {
  private ctx!: Vitest;
  private llmMode: boolean = false;
  private failures: Array<{
    file: string;
    testName: string;
    location: string;
    error: string;
    expected?: string;
    actual?: string;
  }> = [];

  onInit(ctx: Vitest) {
    this.ctx = ctx;

    // Check for LLM_OUTPUT environment variable
    this.llmMode = process.env.LLM_OUTPUT === '1';

    if (this.llmMode) {
      // Suppress default Vitest output by configuring reporter
      // Note: We can't completely suppress default output, but we minimize it
      ctx.logger.clearScreen = () => {};
    }
  }

  onFinished(files?: File[]) {
    if (!files) return;

    // Collect all failures
    this.failures = [];
    for (const file of files) {
      this.collectFailures(file.tasks, file.filepath);
    }

    // LLM mode: Always output (success or failure)
    if (this.llmMode) {
      this.outputLLMFormat();
      return;
    }

    // Standard mode: Only output if there are failures (adds summary after default output)
    if (this.failures.length > 0) {
      this.outputStandardSummary();
    }
  }

  private outputLLMFormat() {
    // Clear screen for clean output
    console.log('\n');

    if (this.failures.length === 0) {
      console.log('✅ All tests passed');
      return;
    }

    // Output failures in concise format
    this.failures.forEach((failure, idx) => {
      console.log(`[Test ${idx + 1}/${this.failures.length}] ${failure.location}`);
      console.log('');
      console.log(`Test: ${failure.testName}`);
      console.log(`Error: ${failure.error}`);

      if (failure.expected && failure.actual) {
        console.log(`Expected: ${failure.expected}`);
        console.log(`Actual: ${failure.actual}`);
      }

      if (idx < this.failures.length - 1) {
        console.log(''); // Blank line between failures
      }
    });

    console.log('');
    console.log('='.repeat(60));
    console.log(`❌ ${this.failures.length} test(s) failed`);
    console.log('='.repeat(60));
  }

  private outputStandardSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('❌ Test Failures (LLM-Optimized Format)');
    console.log('='.repeat(60) + '\n');

    this.failures.forEach((failure, idx) => {
      console.log(`[Test ${idx + 1}/${this.failures.length}] ${failure.location}`);
      console.log('');
      console.log(`Test: ${failure.testName}`);
      console.log(`Error: ${failure.error}`);

      if (failure.expected && failure.actual) {
        console.log(`Expected: ${failure.expected}`);
        console.log(`Actual: ${failure.actual}`);
      }

      console.log('');
    });

    console.log('='.repeat(60));
    console.log(`💡 ${this.failures.length} test(s) failed.`);
    console.log('Fix the assertions shown above, then re-run tests.');
    console.log('Tip: Use --llm-output flag for concise output only');
    console.log('='.repeat(60) + '\n');
  }

  private collectFailures(tasks: Task[], filepath: string) {
    for (const task of tasks) {
      if (task.type === 'suite') {
        this.collectFailures(task.tasks, filepath);
      } else if (task.type === 'test' && task.result?.state === 'fail') {
        const error = task.result.errors?.[0];
        if (!error) continue;

        const testName = this.getFullTestName(task);
        const location = error.stack?.match(/([^(]+):(\d+):(\d+)/)?.[0] || filepath;

        // Extract expected/actual from error message
        const { expected, actual } = this.extractExpectedActual(error.message || '');

        this.failures.push({
          file: filepath,
          testName,
          location,
          error: error.message || 'Unknown error',
          expected,
          actual
        });
      }
    }
  }

  private getFullTestName(task: Task): string {
    const parts: string[] = [];
    let current: Task | undefined = task;

    while (current) {
      if (current.name) {
        parts.unshift(current.name);
      }
      current = current.suite;
    }

    return parts.join(' > ');
  }

  private extractExpectedActual(message: string): { expected?: string; actual?: string } {
    // Match patterns like: "expected 3000 to be 9999"
    const match = message.match(/expected (.+?) to (?:be|equal) (.+)/i);
    if (match) {
      return {
        actual: match[1].trim(),
        expected: match[2].trim()
      };
    }
    return {};
  }
}
