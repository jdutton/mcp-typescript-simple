#!/usr/bin/env tsx
/**
 * Security Check: Admin Endpoint Protection
 *
 * Scans route files to ensure admin endpoints have authentication middleware.
 * Fails validation if any admin route lacks proper authentication.
 *
 * Exit codes:
 * - 0: All admin endpoints properly protected
 * - 1: Found unprotected admin endpoints
 *
 * Usage:
 *   npx tsx tools/security/check-admin-auth.ts
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { relative } from 'node:path';

interface Violation {
  file: string;
  line: number;
  content: string;
  endpoint: string;
}

// Patterns to detect admin routes
const adminRoutePatterns = [
  /router\.(get|post|put|delete|patch)\s*\(\s*['"`](\/admin\/[^'"`]+)['"`]/g,
];

// Patterns that indicate authentication middleware is present
const authMiddlewarePatterns = [
  /requireAdminAuth/,
  /requireAuth/,
  /authenticate/,
  /verifyToken/,
  /checkAuth/,
  /requireInitialAccessToken/,
];

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Check each admin route pattern
    for (const pattern of adminRoutePatterns) {
      pattern.lastIndex = 0; // Reset regex state
      const match = pattern.exec(line);

      if (match) {
        const endpoint = match[2];
        const method = match[1].toUpperCase();

        // Skip health check endpoint (intentionally public)
        if (endpoint === '/admin/health') {
          continue;
        }

        // Check if this route is inside a devMode block (intentionally unprotected)
        const contextStart = Math.max(0, index - 10);
        const contextEnd = Math.min(lines.length, index + 3);
        const context = lines.slice(contextStart, contextEnd).join('\n');

        // Skip if inside devMode conditional (development-only unprotected routes)
        if (/if\s*\(\s*devMode\s*\)/.test(context)) {
          continue;
        }

        // Check if auth middleware is present in the line or nearby context
        let hasAuth = false;
        for (const authPattern of authMiddlewarePatterns) {
          if (authPattern.test(context)) {
            hasAuth = true;
            break;
          }
        }

        if (!hasAuth) {
          violations.push({
            file: filePath,
            line: index + 1,
            content: line.trim(),
            endpoint: `${method} ${endpoint}`,
          });
        }
      }
    }
  });

  return violations;
}

function main() {
  console.log('🔒 Security Check: Admin Endpoint Protection');
  console.log('──────────────────────────────────────────────────\n');

  // Find all route files
  const routeFiles = globSync('packages/http-server/src/server/routes/**/*-routes.ts');

  if (routeFiles.length === 0) {
    console.error('❌ No route files found');
    process.exit(1);
  }

  console.log(`Scanning ${routeFiles.length} route file(s)...\n`);

  let totalViolations: Violation[] = [];

  for (const file of routeFiles) {
    const violations = checkFile(file);
    totalViolations = [...totalViolations, ...violations];
  }

  if (totalViolations.length > 0) {
    console.error(`❌ Found ${totalViolations.length} unprotected admin endpoint(s):\n`);

    for (const violation of totalViolations) {
      const relPath = relative(process.cwd(), violation.file);
      console.error(`  ${relPath}:${violation.line}`);
      console.error(`  → ${violation.endpoint}`);
      console.error(`  ⚠️  ${violation.content}`);
      console.error('');
    }

    console.error('💡 Fix: Add authentication middleware to protect admin endpoints');
    console.error('   Example: router.get(\'/admin/endpoint\', requireAdminAuth, handler)');
    console.error('');
    console.error('──────────────────────────────────────────────────');
    process.exit(1);
  }

  console.log('✅ All admin endpoints properly protected');
  console.log('──────────────────────────────────────────────────');
  process.exit(0);
}

main();
