#!/usr/bin/env tsx
/**
 * Security Check: Production File Storage
 *
 * Detects file-based storage of secrets in production environments.
 * Specifically looks for:
 * - fs.writeFile* operations storing sensitive data
 * - File-based persistence that should use Redis/database instead
 *
 * Exit codes:
 * - 0: No production file storage issues found
 * - 1: Found file storage of secrets in production code
 *
 * Usage:
 *   npx tsx tools/security/check-file-storage.ts
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { relative } from 'node:path';

interface Violation {
  file: string;
  line: number;
  content: string;
  reason: string;
}

// Patterns that indicate file writing
const fileWritePatterns = [
  /fs\.writeFile/,
  /fs\.writeFileSync/,
  /promises\.writeFile/,
  /fs\.appendFile/,
  /fs\.appendFileSync/,
  /createWriteStream/,
];

// Patterns that indicate sensitive data
const sensitiveDataPatterns = [
  /oauth.*client/i,
  /secret/i,
  /token/i,
  /credential/i,
  /password/i,
  /api.*key/i,
];

// Safe file operations (config, logs, cache, encrypted development stores)
const safeOperations = [
  /\.log$/,
  /\.cache$/,
  /\.tmp$/,
  /package\.json$/,
  /tsconfig\.json$/,
  // Allow encrypted file stores (development only - use Redis in production)
  /\/stores\/file\//,
  /file.*store\.ts$/,
  /encrypted.*file.*provider\.ts$/,
  /file.*secrets.*provider\.ts$/,
];

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Check if this line contains file writing
    const hasFileWrite = fileWritePatterns.some(pattern => pattern.test(line));

    if (!hasFileWrite) {
      continue;
    }

    // Get context (10 lines before and after)
    const contextStart = Math.max(0, index - 10);
    const contextEnd = Math.min(lines.length, index + 10);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    // Check if file path or context suggests safe operation
    const isSafe = safeOperations.some(pattern =>
      pattern.test(filePath) || pattern.test(context)
    );
    if (isSafe) {
      continue;
    }

    // Check if context contains sensitive data indicators
    const hasSensitiveData = sensitiveDataPatterns.some(pattern => pattern.test(context));

    if (hasSensitiveData) {
      // Determine which sensitive data pattern matched
      const matchedPattern = sensitiveDataPatterns.find(pattern => pattern.test(context));
      const dataType = matchedPattern?.source || 'sensitive data';

      violations.push({
        file: filePath,
        line: index + 1,
        content: line.trim(),
        reason: `File storage of ${dataType} detected`,
      });
    }
  }

  return violations;
}

function main() {
  console.log('💾 Security Check: Production File Storage');
  console.log('──────────────────────────────────────────────────\n');

  // Scan source files (excluding tests and dev tools)
  const sourceFiles = globSync('packages/*/src/**/*.ts', {
    ignore: ['**/test/**', '**/*.test.ts', '**/*.spec.ts', '**/tools/**'],
  });

  if (sourceFiles.length === 0) {
    console.error('❌ No source files found');
    process.exit(1);
  }

  console.log(`Scanning ${sourceFiles.length} source file(s)...\n`);

  let allViolations: Violation[] = [];

  for (const file of sourceFiles) {
    const violations = checkFile(file);
    allViolations = [...allViolations, ...violations];
  }

  if (allViolations.length > 0) {
    console.error(`❌ Found ${allViolations.length} file storage violation(s):\n`);

    for (const violation of allViolations) {
      const relPath = relative(process.cwd(), violation.file);
      console.error(`  ${relPath}:${violation.line}`);
      console.error(`  🔴 ${violation.reason}`);
      console.error(`  ⚠️  ${violation.content}`);
      console.error('');
    }

    console.error('💡 Fix: Use Redis or encrypted database storage for secrets in production');
    console.error('   - For OAuth clients: Store in Redis with REDIS_URL');
    console.error('   - For tokens: Store in Redis or PostgreSQL');
    console.error('   - For credentials: Use environment variables or secret management');
    console.error('');
    console.error('   Example:');
    console.error('   ❌ Bad:  fs.writeFileSync("oauth-clients.json", JSON.stringify(clients))');
    console.error('   ✅ Good: await redis.set(`oauth:client:${id}`, JSON.stringify(client))');
    console.error('');
    console.error('──────────────────────────────────────────────────');
    process.exit(1);
  }

  console.log('✅ No production file storage issues found');
  console.log('──────────────────────────────────────────────────');
  process.exit(0);
}

main();
