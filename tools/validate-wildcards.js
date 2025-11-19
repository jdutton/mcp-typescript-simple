#!/usr/bin/env node
/**
 * Validate Wildcard Dependencies
 *
 * Ensures all internal @mcp-typescript-simple/* dependencies use "*" wildcards
 * in package.json files. This prevents accidentally committing hardcoded versions
 * after running prepare-publish.
 *
 * Usage:
 *   npm run validate:wildcards          # Validation only
 *   npm run validate:wildcards -- --fix # Auto-fix hardcoded versions to "*"
 *
 * Exit codes:
 *   0 - All dependencies use "*" wildcards
 *   1 - Found hardcoded versions (validation failed)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Colors for output
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Check a single package for hardcoded versions
 */
function checkPackage(pkgPath, autoFix = false) {
  const content = readFileSync(pkgPath, 'utf8');
  const pkgJson = JSON.parse(content);

  const violations = [];
  let fixed = false;

  const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];

  for (const depType of depTypes) {
    if (!pkgJson[depType]) continue;

    for (const [depName, depVersion] of Object.entries(pkgJson[depType])) {
      if (depName.startsWith('@mcp-typescript-simple/') && depVersion !== '*') {
        violations.push({
          depType,
          dependency: depName,
          version: depVersion,
        });

        if (autoFix) {
          pkgJson[depType][depName] = '*';
          fixed = true;
        }
      }
    }
  }

  if (fixed) {
    writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
  }

  return { violations, fixed };
}

/**
 * Validate all packages
 */
function validateWildcards(autoFix = false) {
  const packagesDir = join(PROJECT_ROOT, 'packages');
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const allViolations = [];
  let fixedCount = 0;

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    const content = readFileSync(pkgPath, 'utf8');
    const pkgJson = JSON.parse(content);

    const { violations, fixed } = checkPackage(pkgPath, autoFix);

    if (violations.length > 0) {
      allViolations.push({
        package: pkgJson.name,
        violations,
      });

      if (fixed) {
        fixedCount++;
      }
    }
  }

  return { allViolations, fixedCount };
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const autoFix = args.includes('--fix');

  if (autoFix) {
    log('🔧 Validating and fixing wildcard dependencies...', 'blue');
  } else {
    log('🔍 Validating wildcard dependencies...', 'blue');
  }
  console.log('');

  const { allViolations, fixedCount } = validateWildcards(autoFix);

  if (allViolations.length === 0) {
    log('✅ All internal dependencies use "*" wildcards', 'green');
    process.exit(0);
  }

  if (autoFix) {
    log(`✅ Fixed ${fixedCount} package(s)`, 'green');
    console.log('');
    log('Changed hardcoded versions to "*" wildcards:', 'blue');
    console.log('');

    for (const pkg of allViolations) {
      log(`  ${pkg.package}`, 'green');
      for (const v of pkg.violations) {
        log(`    ${v.depType}.${v.dependency}: "${v.version}" → "*"`, 'blue');
      }
    }

    console.log('');
    log('💡 Changes have been applied. Review and commit.', 'blue');
    process.exit(0);
  }

  // Validation mode - report violations
  log('❌ VALIDATION FAILED: Found hardcoded versions', 'red');
  console.log('');
  log('Internal dependencies MUST use "*" wildcards in source code.', 'yellow');
  log('Found hardcoded versions in:', 'yellow');
  console.log('');

  for (const pkg of allViolations) {
    log(`  ${pkg.package}`, 'red');
    for (const v of pkg.violations) {
      log(`    ${v.depType}.${v.dependency}: "${v.version}" (should be "*")`, 'yellow');
    }
  }

  console.log('');
  log('💡 Fix options:', 'blue');
  log('   Auto-fix:   npm run validate:wildcards -- --fix', 'blue');
  log('   Manual fix: Change versions to "*" in package.json files', 'blue');
  log('   Revert:     git checkout -- packages/*/package.json', 'blue');

  process.exit(1);
}

main();
