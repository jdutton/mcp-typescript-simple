#!/usr/bin/env node
/**
 * Fix Publish Dependencies
 *
 * Converts internal @mcp-typescript-simple/* dependencies from "*" to exact versions
 * before publishing. This is called automatically by npm's prepublishOnly hook.
 *
 * How it works:
 * 1. Reads package.json
 * 2. Gets current version
 * 3. Replaces all "@mcp-typescript-simple/*": "*" with current version
 * 4. Updates package.json
 * 5. npm publish uses the modified package.json
 * 6. postpublish hook reverts changes (keeps "*" in git)
 *
 * This ensures published packages have exact versions while development uses "*" wildcards.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_PATH = join(process.cwd(), 'package.json');

try {
  const content = readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(content);
  const version = pkg.version;

  if (!version) {
    console.error('❌ No version found in package.json');
    process.exit(1);
  }

  let modified = false;

  // Process dependencies, devDependencies, and peerDependencies
  const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];

  for (const depType of depTypes) {
    if (!pkg[depType]) continue;

    for (const [depName, depVersion] of Object.entries(pkg[depType])) {
      if (depName.startsWith('@mcp-typescript-simple/') && depVersion === '*') {
        pkg[depType][depName] = version;
        modified = true;
        console.log(`  ✓ ${depType}.${depName}: "*" → "${version}"`);
      }
    }
  }

  if (modified) {
    writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`✅ Fixed ${pkg.name} dependencies for publishing`);
  } else {
    console.log(`ℹ️  No changes needed for ${pkg.name}`);
  }
} catch (error) {
  console.error(`❌ Failed to fix dependencies: ${error.message}`);
  process.exit(1);
}
