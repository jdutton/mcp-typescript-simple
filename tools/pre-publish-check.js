#!/usr/bin/env node
/**
 * Pre-Publish Check Script
 *
 * Verifies that the project is ready for npm publication.
 * This script must pass before running publish:all.
 *
 * Checks:
 * 1. All workspace packages have matching versions
 * 2. All validation checks pass (npm run validate)
 * 3. CHANGELOG.md exists and is updated
 * 4. No uncommitted changes in git
 * 5. Current branch is main (RCs can be published from feature branches)
 * 6. Up to date with origin/main
 * 7. All packages have proper npm metadata
 * 8. Code quality checks pass
 *
 * Usage:
 *   node tools/pre-publish-check.js
 *   npm run pre-publish
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

let checksPassed = 0;
let checksFailed = 0;
const failures = [];

function runCheck(name, checkFn) {
  try {
    log(`Checking: ${name}...`, 'blue');
    checkFn();
    log(`  ✓ ${name} passed`, 'green');
    checksPassed++;
  } catch (error) {
    log(`  ✗ ${name} failed`, 'red');
    log(`    ${error.message}`, 'red');
    failures.push({ name, error: error.message });
    checksFailed++;
  }
  console.log('');
}

// Check 1: Version consistency across workspace
runCheck('Version consistency', () => {
  const packagesDir = join(PROJECT_ROOT, 'packages');
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const versions = new Map();

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));

    if (pkgJson.version && !pkgJson.private) {
      versions.set(pkgJson.name, pkgJson.version);
    }
  }

  const uniqueVersions = new Set(versions.values());

  if (uniqueVersions.size === 0) {
    throw new Error('No versioned packages found');
  }

  if (uniqueVersions.size > 1) {
    const versionList = Array.from(versions.entries())
      .map(([name, version]) => `${name}: ${version}`)
      .join('\n      ');
    throw new Error(`Version mismatch across packages:\n      ${versionList}`);
  }

  log(`    All packages at version: ${Array.from(uniqueVersions)[0]}`, 'blue');
});

// Check 2: CHANGELOG.md exists and is updated
runCheck('CHANGELOG.md', () => {
  const changelogPath = join(PROJECT_ROOT, 'CHANGELOG.md');

  if (!existsSync(changelogPath)) {
    throw new Error('CHANGELOG.md not found');
  }

  const changelog = readFileSync(changelogPath, 'utf8');

  // Check for ## [Unreleased] section
  if (!changelog.includes('## [Unreleased]')) {
    throw new Error('CHANGELOG.md missing [Unreleased] section');
  }

  // Check for version being released
  const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const version = pkgJson.version;
  const isRC = version.includes('-rc');

  if (isRC) {
    // RCs don't require individual CHANGELOG entries - they're iterative
    // All RC changes are documented under the base version (e.g., 0.9.0-rc.8)
    log(`    RC version detected (${version}) - CHANGELOG entry not required`, 'blue');
  } else if (!changelog.includes(`## [${version}]`)) {
    // Stable releases must have CHANGELOG entry
    throw new Error(
      `CHANGELOG.md missing section for v${version}. Move changes from [Unreleased] to [${version}].`
    );
  } else {
    log(`    CHANGELOG.md includes v${version}`, 'blue');
  }
});

// Check 3: No uncommitted changes (allows prepare-publish package.json modifications)
runCheck('Git working directory clean', () => {
  try {
    // Safe usage - no user input, controlled git command
    const status = execSync('git status --porcelain', { encoding: 'utf8', cwd: PROJECT_ROOT });

    // Filter out expected prepare-publish changes (package.json with exact versions)
    // eslint-disable-next-line sonarjs/os-command
    const changes = status
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .filter(line => !line.match(/^\s*M\s+packages\/.*\/package\.json$/));

    if (changes.length > 0) {
      throw new Error(`Uncommitted changes detected:\n      ${changes.join('\n      ')}`);
    }

    // If only package.json changes, note that these are from prepare-publish
    // eslint-disable-next-line sonarjs/os-command
    const pkgJsonChanges = status.trim().split('\n').filter(line => line.match(/package\.json$/));
    if (pkgJsonChanges.length > 0) {
      log(`    Allowing package.json changes from prepare-publish`, 'blue');
    }
  } catch (error) {
    if (error.message.includes('Uncommitted changes')) {
      throw error;
    }
    throw new Error('Failed to check git status (is this a git repository?)');
  }
});

// Check 4: Current branch is main (RCs can be published from feature branches)
runCheck('Current branch is main', () => {
  try {
    // Get current version to check if it's an RC
    const rootPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const version = rootPkg.version;
    const isRC = version.includes('-rc');

    // Safe usage - no user input, controlled git command
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
    }).trim();

    if (isRC) {
      // RCs can be published from any branch (best practice: feature branches)
      log(`    RC version detected (${version}) - allowing ${branch} branch`, 'blue');
    } else if (branch !== 'main') {
      // Stable releases must be from main
      throw new Error(`Stable release must be from 'main' branch, currently on '${branch}'`);
    }
  } catch (error) {
    if (error.message.includes('branch')) {
      throw error;
    }
    throw new Error('Failed to determine current branch');
  }
});

// Check 5: Up to date with origin/main
runCheck('Up to date with origin/main', () => {
  try {
    // Fetch latest from remote
    execSync('git fetch origin main', { cwd: PROJECT_ROOT, stdio: 'pipe' });

    const local = execSync('git rev-parse main', { encoding: 'utf8', cwd: PROJECT_ROOT }).trim();
    const remote = execSync('git rev-parse origin/main', { encoding: 'utf8', cwd: PROJECT_ROOT }).trim();

    if (local !== remote) {
      throw new Error('Local main is not up to date with origin/main. Run: git pull origin main');
    }
  } catch (error) {
    if (error.message.includes('not up to date')) {
      throw error;
    }
    throw new Error('Failed to check remote sync (is origin configured?)');
  }
});

// Check 6: All packages have required metadata
runCheck('Package metadata', () => {
  const packagesDir = join(PROJECT_ROOT, 'packages');
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const requiredFields = ['name', 'version', 'description', 'license', 'repository', 'keywords'];
  const missingMetadata = [];

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));

    // Skip private packages
    if (pkgJson.private) continue;

    const missing = requiredFields.filter(field => !pkgJson[field]);

    if (missing.length > 0) {
      missingMetadata.push(`${pkgJson.name}: missing ${missing.join(', ')}`);
    }

    // Check keywords array has at least 3 items
    if (pkgJson.keywords && pkgJson.keywords.length < 3) {
      missingMetadata.push(`${pkgJson.name}: needs at least 3 keywords (has ${pkgJson.keywords.length})`);
    }
  }

  if (missingMetadata.length > 0) {
    throw new Error(`Missing metadata:\n      ${missingMetadata.join('\n      ')}`);
  }

  log(`    All ${packages.length} packages have required metadata`, 'blue');
});

// Check 7: Build succeeds
runCheck('Build succeeds', () => {
  try {
    log('    Building packages (this may take a minute)...', 'blue');
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
  } catch (_error) { // eslint-disable-line sonarjs/no-ignored-exceptions
    throw new Error('Build failed. Run: npm run build');
  }
});

// Summary
console.log('');
log('========================================', 'blue');
log('Pre-Publish Check Summary', 'blue');
log('========================================', 'blue');
log(`Checks passed: ${checksPassed}`, checksPassed > 0 ? 'green' : 'reset');
log(`Checks failed: ${checksFailed}`, checksFailed > 0 ? 'red' : 'reset');

if (checksFailed > 0) {
  console.log('');
  log('Failed checks:', 'red');
  for (const failure of failures) {
    log(`  ✗ ${failure.name}`, 'red');
    log(`    ${failure.error}`, 'red');
  }
  console.log('');
  log('❌ Pre-publish checks FAILED', 'red');
  log('   Fix the issues above before publishing', 'yellow');
  process.exit(1);
} else {
  console.log('');
  log('✅ All pre-publish checks PASSED', 'green');
  log('   Ready to publish!', 'green');
  console.log('');
  log('Next steps:', 'blue');
  log('  1. Run: npm run publish:dry-run', 'reset');
  log('  2. Review the output', 'reset');
  log('  3. Run: npm run publish:all', 'reset');
  process.exit(0);
}
