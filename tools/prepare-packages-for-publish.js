#!/usr/bin/env node
/**
 * Prepare Packages for Publishing
 *
 * Converts all internal @mcp-typescript-simple/* dependencies from "*" to exact versions
 * before publishing. Run this before `npm run publish:all`.
 *
 * After publishing, run `git checkout -- packages/STAR/package.json` to revert changes.
 * (Replace STAR with asterisk)
 *
 * How it works:
 * 1. Reads all workspace package.json files
 * 2. Gets each package's version
 * 3. Replaces all "@mcp-typescript-simple/*": "*" with exact version
 * 4. Updates all package.json files
 * 5. You publish
 * 6. Revert with git checkout
 *
 * This ensures published packages have exact versions while development keeps "*" wildcards.
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
 * Fix dependencies in a single package
 */
function fixPackageDependencies(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(content);
    const version = pkg.version;

    if (!version) {
      return { skipped: true, reason: 'no-version', name: pkg.name };
    }

    let changesMade = 0;
    const changes = [];

    // Process dependencies, devDependencies, and peerDependencies
    const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];

    for (const depType of depTypes) {
      if (!pkg[depType]) continue;

      for (const [depName, depVersion] of Object.entries(pkg[depType])) {
        // Convert @mcp-typescript-simple/* with "*" to exact version
        if (depName.startsWith('@mcp-typescript-simple/') && depVersion === '*') {
          pkg[depType][depName] = version;
          changesMade++;
          changes.push(`${depType}.${depName}: "*" → "${version}"`);
        }
      }
    }

    if (changesMade === 0) {
      return { updated: false, name: pkg.name };
    }

    // Write updated package.json
    writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    return { updated: true, name: pkg.name, changesMade, changes };
  } catch (error) {
    throw new Error(`Failed to fix ${filePath}: ${error.message}`);
  }
}

// Main execution
log('🔧 Preparing packages for publishing...', 'blue');
console.log('');

const packagesDir = join(PROJECT_ROOT, 'packages');
let updatedCount = 0;
let skippedCount = 0;
let totalChanges = 0;

try {
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');

    try {
      const result = fixPackageDependencies(pkgPath);

      if (result.updated) {
        log(`  ✓ ${result.name}`, 'green');
        for (const change of result.changes) {
          log(`    - ${change}`, 'blue');
        }
        updatedCount++;
        totalChanges += result.changesMade;
      } else if (result.skipped) {
        log(`  - ${result.name}: skipped (${result.reason})`, 'yellow');
        skippedCount++;
      } else {
        log(`  - ${result.name}: no changes needed`, 'yellow');
        skippedCount++;
      }
    } catch (error) {
      log(`  ✗ ${pkg}: ${error.message}`, 'red');
      process.exit(1);
    }
  }
} catch (error) {
  log(`✗ Failed to read packages directory: ${error.message}`, 'red');
  process.exit(1);
}

console.log('');
log(`✅ Preparation complete!`, 'green');
log(`   Packages updated: ${updatedCount}`, 'green');
log(`   Packages skipped: ${skippedCount}`, 'yellow');
log(`   Total changes: ${totalChanges}`, 'green');
console.log('');
log('💡 Next steps:', 'blue');
log('   1. Run: npm run publish:all', 'blue');
log('   2. After publishing, revert: git checkout -- packages/*/package.json', 'blue');
