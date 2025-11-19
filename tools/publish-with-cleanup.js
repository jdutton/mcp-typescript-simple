#!/usr/bin/env node
/**
 * Automated Publish Workflow with Cleanup
 *
 * This script automates the entire npm publication workflow:
 * 1. Validates that all dependencies use "*" wildcards
 * 2. Runs prepare-publish (converts "*" to exact versions)
 * 3. Publishes all packages in dependency order
 * 4. ALWAYS reverts package.json files (even on failure)
 *
 * Usage:
 *   npm run publish:automated              # Production publish
 *   npm run publish:automated -- --dry-run # Test without publishing
 *   npm run publish:automated -- --tag next # Publish with npm tag
 *
 * Safety features:
 * - Pre-flight validation of "*" wildcards
 * - Automatic cleanup (even if publish fails)
 * - Dry-run mode for testing
 * - Exit code propagation
 */

import { execSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
  magenta: '\x1b[0;35m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('');
  log(`${'='.repeat(60)}`, 'cyan');
  log(title, 'cyan');
  log(`${'='.repeat(60)}`, 'cyan');
  console.log('');
}

/**
 * Check if dependency is internal and has hardcoded version
 */
function isInternalDependencyViolation(depName, depVersion) {
  return depName.startsWith('@mcp-typescript-simple/') && depVersion !== '*';
}

/**
 * Find wildcard violations in a single package
 */
function findPackageViolations(pkgJson, depTypes) {
  const violations = [];

  for (const depType of depTypes) {
    if (!pkgJson[depType]) continue;

    for (const [depName, depVersion] of Object.entries(pkgJson[depType])) {
      if (isInternalDependencyViolation(depName, depVersion)) {
        violations.push({
          package: pkgJson.name,
          depType,
          dependency: depName,
          version: depVersion,
        });
      }
    }
  }

  return violations;
}

/**
 * Report wildcard violations
 */
function reportViolations(violations) {
  log('❌ VALIDATION FAILED: Found hardcoded versions', 'red');
  console.log('');
  log('Internal dependencies MUST use "*" wildcards in source code.', 'yellow');
  log('Found hardcoded versions in:', 'yellow');
  console.log('');

  for (const v of violations) {
    log(`  ${v.package}`, 'red');
    log(`    ${v.depType}.${v.dependency}: "${v.version}" (should be "*")`, 'yellow');
  }

  console.log('');
  log('💡 Fix: Change all hardcoded versions to "*" in package.json files', 'blue');
  log('   Then run this script again.', 'blue');
}

/**
 * Validate that all internal dependencies use "*" wildcards
 */
function validateWildcards() {
  logSection('Step 1: Validating "*" wildcards');

  const packagesDir = join(PROJECT_ROOT, 'packages');
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];
  const allViolations = [];

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const violations = findPackageViolations(pkgJson, depTypes);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    reportViolations(allViolations);
    return false;
  }

  log('✅ All internal dependencies use "*" wildcards', 'green');
  return true;
}

/**
 * Run prepare-publish script
 */
function preparePublish() {
  logSection('Step 2: Preparing packages for publish');

  try {
    execSync('npm run prepare-publish', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    log('✅ Packages prepared successfully', 'green');
    return true;
  } catch (error) {
    log('❌ Prepare-publish failed', 'red');
    return false;
  }
}

/**
 * Publish all packages
 */
function publishPackages(isDryRun, npmTag) {
  logSection(`Step 3: Publishing packages${isDryRun ? ' (DRY RUN)' : ''}`);

  const publishScript = isDryRun ? 'publish:dry-run' : 'publish:all';

  try {
    const args = ['run', publishScript];

    // Add tag if specified
    if (npmTag && !isDryRun) {
      // The publish:all script needs to pass --tag to npm publish
      log(`📦 Publishing with tag: ${npmTag}`, 'blue');
      process.env.NPM_TAG = npmTag;
    }

    execSync(`npm ${args.join(' ')}`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });

    log(isDryRun ? '✅ Dry-run completed' : '✅ Packages published', 'green');
    return true;
  } catch (error) {
    log(isDryRun ? '❌ Dry-run failed' : '❌ Publishing failed', 'red');
    return false;
  }
}

/**
 * Cleanup: Revert package.json files to "*" wildcards
 */
function cleanup() {
  logSection('Step 4: Cleanup (reverting to "*" wildcards)');

  try {
    execSync('git checkout -- packages/*/package.json', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    log('✅ Package.json files reverted to "*" wildcards', 'green');
    return true;
  } catch (error) {
    log('❌ Cleanup failed - manual intervention required', 'red');
    log('   Run: git checkout -- packages/*/package.json', 'yellow');
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tagIndex = args.indexOf('--tag');
  const npmTag = tagIndex !== -1 ? args[tagIndex + 1] : null;

  log('🚀 Automated Publish Workflow', 'magenta');
  console.log('');

  if (isDryRun) {
    log('ℹ️  DRY RUN MODE - No packages will be published', 'yellow');
  }

  if (npmTag) {
    log(`ℹ️  Publishing with tag: ${npmTag}`, 'blue');
  }

  let exitCode = 0;
  let publishSucceeded = false;

  try {
    // Step 1: Validate wildcards
    if (!validateWildcards()) {
      exitCode = 1;
      return;
    }

    // Step 2: Prepare packages
    if (!preparePublish()) {
      exitCode = 1;
      return;
    }

    // Step 3: Publish
    publishSucceeded = publishPackages(isDryRun, npmTag);
    if (!publishSucceeded) {
      exitCode = 1;
    }
  } finally {
    // Step 4: ALWAYS cleanup (even on failure)
    if (!cleanup()) {
      exitCode = 1;
    }

    // Final summary
    logSection('Summary');

    if (exitCode === 0) {
      if (isDryRun) {
        log('✅ Dry-run completed successfully', 'green');
        log('   All package.json files reverted to "*" wildcards', 'green');
      } else {
        log('✅ Packages published successfully', 'green');
        log('   All package.json files reverted to "*" wildcards', 'green');
        console.log('');
        log('📋 Next steps:', 'blue');
        log('   1. Verify packages on npm: npm run verify-npm-packages', 'blue');
        log('   2. Test scaffolding: npm create @mcp-typescript-simple@latest test-proj', 'blue');
        log('   3. Push tags: git push origin main --tags', 'blue');
      }
    } else {
      log('❌ Workflow failed', 'red');
      log('   Package.json files have been reverted to "*" wildcards', 'yellow');
      log('   Check errors above for details', 'yellow');
    }

    process.exit(exitCode);
  }
}

main().catch(error => {
  log(`❌ Unexpected error: ${error.message}`, 'red');
  console.error(error);

  // Attempt cleanup even on unexpected errors
  try {
    cleanup();
  } catch (cleanupError) {
    log('❌ Cleanup also failed', 'red');
  }

  process.exit(1);
});
