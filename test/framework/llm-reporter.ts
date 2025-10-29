/**
 * LLM-Optimized Vitest Reporter
 *
 * Shows concise failure summaries optimized for AI assistants.
 * - Only shows failures and errors (not passing tests)
 * - Suppresses verbose server logs
 * - Reduces output from 200+ lines to <20 lines on failure
 * - Makes failures immediately visible
 *
 * Used automatically by all test commands and validation.
 * Full verbose logs still written to /tmp/mcp-validation-*.log for debugging.
 *
 * Only applies to Vitest-based tests (test:unit). Integration tests (ci-test.ts)
 * and Playwright tests (test:system:headless) use different test runners.
 *
 * Note: Using deprecated Vitest 2.x Reporter API types (File, Reporter, Task, Vitest)
 * Migration to Vitest 3.x API (onTestRunEnd, TestModule, TestCase) deferred until Phase 5
 * These types still work correctly in Vitest 3.x, just deprecated in favor of new API
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

    // Always use LLM mode for concise output
    this.llmMode = true;

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
    for (const [idx, failure] of this.failures.entries()) {
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
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`❌ ${this.failures.length} test(s) failed`);
    console.log('='.repeat(60));
  }

  private outputStandardSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('❌ Test Failures (LLM-Optimized Format)');
    console.log('='.repeat(60) + '\n');

    for (const [idx, failure] of this.failures.entries()) {
      console.log(`[Test ${idx + 1}/${this.failures.length}] ${failure.location}`);
      console.log('');
      console.log(`Test: ${failure.testName}`);
      console.log(`Error: ${failure.error}`);

      if (failure.expected && failure.actual) {
        console.log(`Expected: ${failure.expected}`);
        console.log(`Actual: ${failure.actual}`);
      }

      console.log('');
    }

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
        // Match file path with line:column from error stack trace
        // Safe: Parsing internal error stacks (not user input), bounded length
         
        const location = error.stack?.match(/([\w/.-]+):(\d+):(\d+)/)?.[0] || filepath;

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
    // Use RegExp.exec() instead of String.match() for better performance
    const regex = /expected (.+?) to (?:be|equal) (.+)/i;
    const match = regex.exec(message);
    if (match) {
      return {
        actual: match[1].trim(),
        expected: match[2].trim()
      };
    }
    return {};
  }
}
