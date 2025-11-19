#!/usr/bin/env node
/**
 * Workspace Protocol Converter
 *
 * Converts all internal @mcp-typescript-simple/* dependencies from "*" to "workspace:*".
 * This ensures pnpm automatically replaces workspace:* with exact versions during publish.
 *
 * Usage:
 *   node tools/convert-to-workspace-protocol.js
 *   npm run convert-workspace
 *
 * What it does:
 * - Finds all package.json files in packages/
 * - Replaces "@mcp-typescript-simple/*": "*" with "workspace:*"
 * - Works for dependencies, devDependencies, and peerDependencies
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error
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
 * Convert dependencies in a package.json file
 */
function convertPackageDependencies(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(content);

    let changesMade = 0;
    const changes = [];

    // Process dependencies, devDependencies, and peerDependencies
    const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];

    for (const depType of depTypes) {
      if (!pkg[depType]) continue;

      for (const [depName, depVersion] of Object.entries(pkg[depType])) {
        // Only convert @mcp-typescript-simple/* packages with "*" version
        if (depName.startsWith('@mcp-typescript-simple/') && depVersion === '*') {
          pkg[depType][depName] = 'workspace:*';
          changesMade++;
          changes.push(`${depType}.${depName}: "*" → "workspace:*"`);
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
    throw new Error(`Failed to convert ${filePath}: ${error.message}`);
  }
}

// Main execution
log('🔧 Converting to workspace:* protocol...', 'blue');
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
      const result = convertPackageDependencies(pkgPath);

      if (result.updated) {
        log(`  ✓ ${result.name}`, 'green');
        result.changes.forEach(change => {
          log(`    - ${change}`, 'blue');
        });
        updatedCount++;
        totalChanges += result.changesMade;
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
log(`✅ Conversion complete!`, 'green');
log(`   Packages updated: ${updatedCount}`, 'green');
log(`   Packages skipped: ${skippedCount}`, 'yellow');
log(`   Total changes: ${totalChanges}`, 'green');
console.log('');
log('💡 Next steps:', 'blue');
log('   1. Review changes: git diff', 'blue');
log('   2. Test locally: npm install', 'blue');
log('   3. Publish with pnpm: npm run publish:all', 'blue');
