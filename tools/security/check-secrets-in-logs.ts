#!/usr/bin/env tsx
/**
 * Security Check: Secrets in Logging
 *
 * Scans source files for logging statements that may expose secrets or PII.
 * This is a warning-only check - may produce false positives that need manual review.
 *
 * Exit codes:
 * - 0: No obvious secret exposure found (or acceptable risk)
 * - 1: Found high-confidence secret exposure patterns
 *
 * Usage:
 *   npx tsx tools/security/check-secrets-in-logs.ts
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { relative } from 'node:path';

interface Finding {
  file: string;
  line: number;
  content: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
}

// High-risk patterns - direct logging of sensitive fields
const highRiskPatterns = [
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*\bpassword\b[^)]*\)/gi, reason: 'Direct password logging' },
  { pattern: /console\.(log|debug|info|warn|error)\([^)]*\bpassword\b[^)]*\)/gi, reason: 'Direct password logging' },
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: scans trusted source code, bounded file size
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*['"`].*\$\{.*\.password.*\}.*['"`]/gi, reason: 'Template literal with password' },
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: scans trusted source code, bounded file size
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*['"`].*\$\{.*\.secret.*\}.*['"`]/gi, reason: 'Template literal with secret' },
];

// Medium-risk patterns - potential secret exposure
const mediumRiskPatterns = [
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*\btoken\b[^)]*\)/gi, reason: 'Potential token logging' },
  { pattern: /console\.(log|debug|info|warn|error)\([^)]*\btoken\b[^)]*\)/gi, reason: 'Potential token logging' },
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*\bapiKey\b[^)]*\)/gi, reason: 'Potential API key logging' },
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*\bapi_key\b[^)]*\)/gi, reason: 'Potential API key logging' },
];

// Low-risk patterns - field names only (less concerning)
const lowRiskPatterns = [
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: scans trusted source code, bounded file size
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*['"`].*secret.*['"`][^)]*\)/gi, reason: 'String contains "secret"' },
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: scans trusted source code, bounded file size
  { pattern: /logger\.(info|debug|warn|error|trace)\([^)]*['"`].*key.*['"`][^)]*\)/gi, reason: 'String contains "key"' },
];

// Safe patterns that should be ignored
const safePatterns = [
  /redact/i,
  /mask/i,
  /\*\*\*\*/,
  /\.substring\(/,
  /\.slice\(/,
  /sanitize/i,
];

function isSafeUsage(context: string): boolean {
  return safePatterns.some(pattern => pattern.test(context));
}

function checkFile(filePath: string): Finding[] {
  const findings: Finding[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Get context (5 lines before and after)
    const contextStart = Math.max(0, index - 5);
    const contextEnd = Math.min(lines.length, index + 5);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    // Skip if this looks like safe usage (redaction, masking, etc.)
    if (isSafeUsage(context)) {
      continue;
    }

    // Check high-risk patterns
    for (const { pattern, reason } of highRiskPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          severity: 'high',
          reason,
        });
      }
    }

    // Check medium-risk patterns
    for (const { pattern, reason } of mediumRiskPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          severity: 'medium',
          reason,
        });
      }
    }

    // Check low-risk patterns
    for (const { pattern, reason } of lowRiskPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          severity: 'low',
          reason,
        });
      }
    }
  }

  return findings;
}

function main() {
  console.log('🔐 Security Check: Secrets in Logging');
  console.log('──────────────────────────────────────────────────\n');

  // Scan source files (excluding tests)
  const sourceFiles = globSync('packages/*/src/**/*.ts', {
    ignore: ['**/test/**', '**/*.test.ts', '**/*.spec.ts'],
  });

  if (sourceFiles.length === 0) {
    console.error('❌ No source files found');
    process.exit(1);
  }

  console.log(`Scanning ${sourceFiles.length} source file(s)...\n`);

  let allFindings: Finding[] = [];

  for (const file of sourceFiles) {
    const findings = checkFile(file);
    allFindings = [...allFindings, ...findings];
  }

  if (allFindings.length === 0) {
    console.log('✅ No obvious secret exposure found in logging');
    console.log('──────────────────────────────────────────────────');
    process.exit(0);
  }

  // Separate by severity
  const highSeverity = allFindings.filter(f => f.severity === 'high');
  const mediumSeverity = allFindings.filter(f => f.severity === 'medium');
  const lowSeverity = allFindings.filter(f => f.severity === 'low');

  if (highSeverity.length > 0) {
    console.error(`❌ Found ${highSeverity.length} HIGH severity finding(s):\n`);
    for (const finding of highSeverity) {
      const relPath = relative(process.cwd(), finding.file);
      console.error(`  ${relPath}:${finding.line}`);
      console.error(`  🔴 ${finding.reason}`);
      console.error(`  ⚠️  ${finding.content}`);
      console.error('');
    }
    console.error('💡 Fix: Remove direct password/secret logging or use redaction');
    console.error('   Example: logger.info({ token: redactToken(token) })');
    console.error('');
  }

  if (mediumSeverity.length > 0) {
    console.warn(`⚠️  Found ${mediumSeverity.length} MEDIUM severity finding(s):\n`);
    for (const finding of mediumSeverity) {
      const relPath = relative(process.cwd(), finding.file);
      console.warn(`  ${relPath}:${finding.line}`);
      console.warn(`  🟡 ${finding.reason}`);
      console.warn(`  ℹ️  ${finding.content}`);
      console.warn('');
    }
    console.warn('💡 Review: Ensure tokens/API keys are redacted before logging');
    console.warn('');
  }

  if (lowSeverity.length > 0) {
    console.log(`ℹ️  Found ${lowSeverity.length} LOW severity finding(s) (review recommended)\n`);
  }

  console.error('──────────────────────────────────────────────────');

  // Fail only on high severity findings
  if (highSeverity.length > 0) {
    process.exit(1);
  }

  // Warn but don't fail on medium/low
  if (mediumSeverity.length > 0) {
    console.warn('⚠️  WARNING: Medium severity findings detected - review recommended');
    console.warn('   (Not failing validation - manual review required)');
  }

  process.exit(0);
}

main();
