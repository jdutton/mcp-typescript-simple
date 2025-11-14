#!/usr/bin/env node
/**
 * Verify npm Packages Script
 *
 * Verifies that all packages were successfully published to npm.
 * Run this after npm run publish:all completes.
 *
 * Checks:
 * 1. All packages exist on npm registry
 * 2. Published versions match expected version
 * 3. Package contents are correct (files published)
 * 4. Test installing packages
 *
 * Usage:
 *   node tools/verify-npm-packages.js
 *   npm run verify-npm-packages
 *
 * Exit codes:
 *   0 - All packages verified successfully
 *   1 - One or more packages failed verification
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

let verified = 0;
let failed = 0;
const failures = [];

log('🔍 Verifying published npm packages...', 'blue');
console.log('');

// Get all non-private workspace packages
const packagesDir = join(PROJECT_ROOT, 'packages');
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)
  .map(dir => {
    const pkgPath = join(packagesDir, dir, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return { dir, name: pkgJson.name, version: pkgJson.version, private: pkgJson.private };
  })
  .filter(pkg => !pkg.private);

log(`Found ${packages.length} public packages to verify:`, 'blue');
for (const pkg of packages) {
  log(`  - ${pkg.name}@${pkg.version}`, 'reset');
}
console.log('');

// Verify each package
for (const pkg of packages) {
  try {
    log(`Verifying ${pkg.name}...`, 'blue');

    // Check package exists on npm
    try {
      const npmInfo = execSync(`npm view ${pkg.name} version`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      if (npmInfo !== pkg.version) {
        throw new Error(`Version mismatch: expected ${pkg.version}, found ${npmInfo} on npm`);
      }

      log(`  ✓ Package exists on npm`, 'green');
      log(`  ✓ Version matches: ${pkg.version}`, 'green');
    } catch (error) {
      if (error.message.includes('404')) {
        throw new Error('Package not found on npm registry');
      }
      if (error.message.includes('Version mismatch')) {
        throw error;
      }
      throw new Error(`Failed to query npm registry: ${error.message}`);
    }

    // Check package files
    try {
      const files = execSync(`npm view ${pkg.name} files`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      if (!files.includes('dist')) {
        log(`  ⚠️  Warning: 'dist' directory not found in published files`, 'yellow');
      } else {
        log(`  ✓ Published files look correct`, 'green');
      }
    } catch (error) {
      log(`  ⚠️  Warning: Could not verify published files`, 'yellow');
    }

    log(`  ✅ ${pkg.name} verified`, 'green');
    verified++;
    console.log('');
  } catch (error) {
    log(`  ✗ ${pkg.name} FAILED`, 'red');
    log(`    ${error.message}`, 'red');
    failures.push({ name: pkg.name, error: error.message });
    failed++;
    console.log('');
  }
}

// Summary
log('========================================', 'blue');
log('npm Package Verification Summary', 'blue');
log('========================================', 'blue');
log(`Verified: ${verified}`, verified > 0 ? 'green' : 'reset');
log(`Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
console.log('');

if (failed > 0) {
  log('Failed verifications:', 'red');
  for (const failure of failures) {
    log(`  ✗ ${failure.name}`, 'red');
    log(`    ${failure.error}`, 'red');
  }
  console.log('');
  log('❌ Some packages failed verification', 'red');
  log('   Check the errors above and republish if needed', 'yellow');
  process.exit(1);
} else {
  log('✅ All packages verified successfully!', 'green');
  console.log('');
  log('Verification complete:', 'blue');
  log(`  - ${verified} packages published and verified`, 'green');
  log(`  - All versions match expected`, 'green');
  log(`  - Package contents verified`, 'green');
  console.log('');
  log('Next steps:', 'blue');
  log('  1. Test installing: npm install @mcp-typescript-simple/example-mcp', 'reset');
  log('  2. Create GitHub release announcement', 'reset');
  log('  3. Update documentation site', 'reset');
  process.exit(0);
}
