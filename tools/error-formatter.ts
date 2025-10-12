/**
 * Error Formatter for LLM-Friendly Validation Output
 *
 * Optimizes validation failure output for consumption by LLMs like Claude Code.
 *
 * Key Optimizations:
 * 1. Remove noise (npm script headers, timestamps, stack traces)
 * 2. Extract actionable errors only
 * 3. Provide context and guidance
 * 4. Minimize token usage
 * 5. Group related errors
 *
 * @extraction-target @agentic-workflow
 */

export interface FormattedError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
  context?: string;  // Surrounding code or additional context
}

export interface ErrorFormatterResult {
  errors: FormattedError[];
  summary: string;
  totalCount: number;
  guidance?: string;  // Step-specific actionable guidance
  cleanOutput: string;  // Formatted output for YAML
}

export class ErrorFormatter {
  /**
   * Format TypeScript compiler errors
   */
  static formatTypeScriptErrors(output: string): ErrorFormatterResult {
    const errors: FormattedError[] = [];

    // TypeScript error pattern: file(line,col): error TSxxxx: message
    const tsErrorPattern = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm;

    let match;
    while ((match = tsErrorPattern.exec(output)) !== null) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6].trim()
      });
    }

    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warningCount = errors.filter(e => e.severity === 'warning').length;

    // Build clean output
    const cleanOutput = errors
      .slice(0, 10)  // Limit to first 10
      .map(e => `${e.file}:${e.line}:${e.column} - ${e.code}: ${e.message}`)
      .join('\n');

    return {
      errors: errors.slice(0, 10),
      summary: `${errorCount} type error(s), ${warningCount} warning(s)`,
      totalCount: errors.length,
      guidance: this.getTypeScriptGuidance(errors),
      cleanOutput
    };
  }

  /**
   * Format ESLint errors
   */
  static formatESLintErrors(output: string): ErrorFormatterResult {
    const errors: FormattedError[] = [];

    // ESLint error pattern (modern format): file:line:col - message [rule-name]
    const eslintPattern = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+(\S+)$/gm;

    let match;
    while ((match = eslintPattern.exec(output)) !== null) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        message: match[5].trim(),
        code: match[6]  // Rule name
      });
    }

    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warningCount = errors.filter(e => e.severity === 'warning').length;

    const cleanOutput = errors
      .slice(0, 10)
      .map(e => `${e.file}:${e.line}:${e.column} - ${e.message} [${e.code}]`)
      .join('\n');

    return {
      errors: errors.slice(0, 10),
      summary: `${errorCount} ESLint error(s), ${warningCount} warning(s)`,
      totalCount: errors.length,
      guidance: this.getESLintGuidance(errors),
      cleanOutput
    };
  }

  /**
   * Format Vitest test failures
   */
  static formatVitestErrors(output: string): ErrorFormatterResult {
    const errors: FormattedError[] = [];

    // Vitest error pattern: FAIL test/path/to/file.test.ts
    // Then look for test names: ✓ or ✗ test name
    const failedTestPattern = /❯\s+(.+)/g;
    const testFilePattern = /FAIL\s+(.+?\.test\.ts)/g;

    // Extract failed test files
    let currentFile = '';
    const lines = output.split('\n');

    for (const line of lines) {
      const fileMatch = testFilePattern.exec(line);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      const testMatch = /❯\s+(.+)/.exec(line);
      if (testMatch && currentFile) {
        errors.push({
          file: currentFile,
          message: testMatch[1].trim()
        });
      }
    }

    const cleanOutput = errors
      .slice(0, 10)
      .map(e => `${e.file} - ${e.message}`)
      .join('\n');

    return {
      errors: errors.slice(0, 10),
      summary: `${errors.length} test failure(s)`,
      totalCount: errors.length,
      guidance: 'Run failed tests individually to debug: npm test -- <test-file>',
      cleanOutput
    };
  }

  /**
   * Format OpenAPI validation errors
   */
  static formatOpenAPIErrors(output: string): ErrorFormatterResult {
    const errors: FormattedError[] = [];

    // OpenAPI errors typically include location in schema
    const lines = output.split('\n')
      .filter(line => line.includes('error') || line.includes('Error'))
      .slice(0, 10);

    const cleanOutput = lines.join('\n');

    return {
      errors: [],
      summary: `${lines.length} OpenAPI validation error(s)`,
      totalCount: lines.length,
      guidance: 'Check openapi.yaml against OpenAPI 3.1 specification',
      cleanOutput
    };
  }

  /**
   * Generic error formatter (fallback)
   */
  static formatGenericErrors(output: string, stepName: string): ErrorFormatterResult {
    // Remove npm script headers
    const cleaned = output
      .split('\n')
      .filter(line => {
        // Remove npm script noise
        if (line.startsWith('>')) return false;
        if (line.includes('npm ERR!')) return false;
        if (line.trim() === '') return false;
        return true;
      })
      .slice(0, 20)  // Limit to 20 lines
      .join('\n');

    return {
      errors: [],
      summary: `${stepName} failed - see output`,
      totalCount: 1,
      cleanOutput: cleaned
    };
  }

  /**
   * Smart formatter - detects step type and applies appropriate formatting
   */
  static formatByStepName(stepName: string, output: string): ErrorFormatterResult {
    if (stepName.includes('TypeScript') || stepName.includes('typecheck')) {
      return this.formatTypeScriptErrors(output);
    }

    if (stepName.includes('ESLint') || stepName.includes('lint')) {
      return this.formatESLintErrors(output);
    }

    if (stepName.includes('test') && !stepName.includes('OpenAPI')) {
      return this.formatVitestErrors(output);
    }

    if (stepName.includes('OpenAPI')) {
      return this.formatOpenAPIErrors(output);
    }

    return this.formatGenericErrors(output, stepName);
  }

  /**
   * Get TypeScript-specific guidance
   */
  private static getTypeScriptGuidance(errors: FormattedError[]): string {
    const errorCodes = new Set(errors.map(e => e.code));
    const guidance: string[] = [];

    if (errorCodes.has('TS2322')) {
      guidance.push('Type mismatch - check variable/parameter types');
    }

    if (errorCodes.has('TS2304')) {
      guidance.push('Cannot find name - check imports and type definitions');
    }

    if (errorCodes.has('TS2345')) {
      guidance.push('Argument type mismatch - check function signatures');
    }

    if (guidance.length === 0) {
      return 'Fix TypeScript type errors in listed files';
    }

    return guidance.join('. ');
  }

  /**
   * Get ESLint-specific guidance
   */
  private static getESLintGuidance(errors: FormattedError[]): string {
    const rules = new Set(errors.map(e => e.code));
    const guidance: string[] = [];

    if (rules.has('@typescript-eslint/no-unused-vars')) {
      guidance.push('Remove or prefix unused variables with underscore');
    }

    if (rules.has('no-console')) {
      guidance.push('Replace console.log with logger');
    }

    if (guidance.length === 0) {
      return 'Fix ESLint errors - run with --fix to auto-fix some issues';
    }

    return guidance.join('. ');
  }

  /**
   * Remove ANSI color codes
   */
  static stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Extract just the error lines (filter out noise)
   */
  static extractErrorLines(output: string): string[] {
    return output
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) return false;

        // Skip npm script headers
        if (trimmed.startsWith('>')) return false;

        // Skip npm errors (too verbose)
        if (trimmed.includes('npm ERR!')) return false;

        // Keep error/warning lines
        return trimmed.includes('error') ||
               trimmed.includes('Error') ||
               trimmed.includes('warning') ||
               trimmed.includes('FAIL') ||
               trimmed.includes('✗') ||
               trimmed.includes('❯');
      });
  }
}
