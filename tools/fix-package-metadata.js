#!/usr/bin/env node
/**
 * Fix Package Metadata Script
 *
 * Updates all workspace packages with:
 * - Version 0.9.0-rc.1
 * - publishConfig.access: public
 * - repository metadata
 * - keywords (if missing)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const version = '0.9.0-rc.1';

const packagesDir = join(PROJECT_ROOT, 'packages');
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

console.log(`\x1b[0;34mFixing metadata for ${packages.length} packages...\x1b[0m\n`);

let updated = 0;

for (const pkgName of packages) {
  const pkgPath = join(packagesDir, pkgName, 'package.json');

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

    // Update version
    pkg.version = version;

    // Add publishConfig
    if (!pkg.publishConfig) {
      pkg.publishConfig = { access: 'public' };
    }

    // Add repository
    if (!pkg.repository) {
      pkg.repository = {
        type: 'git',
        url: 'git+https://github.com/jdutton/mcp-typescript-simple.git',
        directory: `packages/${pkgName}`
      };
    }

    // Add keywords if missing
    if (!pkg.keywords) {
      if (pkgName === 'config') {
        pkg.keywords = ['mcp', 'config', 'configuration', 'environment', 'secrets'];
      } else if (pkgName === 'persistence') {
        pkg.keywords = ['mcp', 'persistence', 'storage', 'redis', 'session', 'data'];
      }
    }

    // Write back with proper formatting
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`\x1b[0;32m  ✓ ${pkg.name}\x1b[0m`);
    updated++;
  } catch (error) {
    console.error(`\x1b[0;31m  ✗ ${pkgName}: ${error.message}\x1b[0m`);
  }
}

console.log(`\n\x1b[0;32m✅ Updated ${updated} packages\x1b[0m`);
