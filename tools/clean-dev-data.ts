#!/usr/bin/env tsx
/**
 * Development Data Cleanup Utility
 *
 * Cleans up file-based data stores for development.
 * Useful for:
 * - Fresh starts during development
 * - Testing with clean state
 * - Removing stale/test data
 *
 * Usage:
 *   npm run dev:clean              # Clean all data files
 *   npm run dev:clean:sessions     # Clean only MCP sessions
 *   npm run dev:clean:tokens       # Clean only access tokens
 *   npm run dev:clean:oauth        # Clean OAuth clients
 *   npm run dev:clean -- --dry-run # Show what would be deleted
 */

import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';

// Define all data files
const DATA_FILES = {
  sessions: './data/mcp-sessions.json',
  tokens: './data/access-tokens.json',
  clients: './data/oauth-clients.json',
  // Future: oauthTokens: './data/oauth-tokens.json',
} as const;

type DataCategory = keyof typeof DATA_FILES;

interface CleanupOptions {
  dryRun?: boolean;
  categories?: DataCategory[];
}

async function fileExists(filePath: string): Promise<boolean> {
  return existsSync(filePath);
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function cleanFile(filePath: string, dryRun: boolean): Promise<boolean> {
  const exists = await fileExists(filePath);

  if (!exists) {
    console.log(`  ⊘ ${filePath} (doesn't exist)`);
    return false;
  }

  const size = await getFileSize(filePath);
  const sizeStr = formatBytes(size);

  if (dryRun) {
    console.log(`  🔍 ${filePath} (${sizeStr}) [would delete]`);
    return true;
  }

  try {
    await fs.unlink(filePath);
    console.log(`  ✅ ${filePath} (${sizeStr}) [deleted]`);
    return true;
  } catch (error) {
    console.error(`  ❌ ${filePath} (${sizeStr}) [error: ${error}]`);
    return false;
  }
}

async function cleanupData(options: CleanupOptions = {}): Promise<void> {
  const { dryRun = false, categories } = options;

  console.log('\n🧹 Development Data Cleanup');
  console.log('=' .repeat(50));

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be deleted\n');
  }

  // Determine which files to clean
  const filesToClean = categories
    ? categories.map(cat => ({ name: cat, path: DATA_FILES[cat] }))
    : (Object.entries(DATA_FILES) as [DataCategory, string][]).map(([name, path]) => ({
        name,
        path,
      }));

  let totalDeleted = 0;
  let totalSize = 0;

  for (const { name, path: filePath } of filesToClean) {
    console.log(`\n📁 ${name}:`);

    const size = await getFileSize(filePath);
    totalSize += size;

    const deleted = await cleanFile(filePath, dryRun);
    if (deleted) {
      totalDeleted++;
    }
  }

  // Clean up backup files too (*.backup)
  if (!categories || categories.length === 0) {
    console.log(`\n📁 backup files:`);

    for (const filePath of Object.values(DATA_FILES)) {
      const backupPath = `${filePath}.backup`;
      if (await fileExists(backupPath)) {
        await cleanFile(backupPath, dryRun);
      }
    }

    // Clean up temp files (*.tmp)
    console.log(`\n📁 temp files:`);

    for (const filePath of Object.values(DATA_FILES)) {
      const tempPath = `${filePath}.tmp`;
      if (await fileExists(tempPath)) {
        await cleanFile(tempPath, dryRun);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Summary:`);
  console.log(`   Files cleaned: ${totalDeleted}`);
  console.log(`   Total size: ${formatBytes(totalSize)}`);

  if (dryRun) {
    console.log(`\n💡 Run without --dry-run to actually delete files`);
  } else {
    console.log(`\n✨ Cleanup complete!`);
  }
}

// Parse command line arguments
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    dryRun: args.includes('--dry-run'),
    categories: undefined,
  };

  // Check for specific category flags
  const categoryArgs = args.filter(arg => !arg.startsWith('--'));
  if (categoryArgs.length > 0) {
    options.categories = categoryArgs
      .filter(arg => arg in DATA_FILES)
      .map(arg => arg as DataCategory);

    if (options.categories.length === 0) {
      console.error(`❌ Invalid category. Valid categories: ${Object.keys(DATA_FILES).join(', ')}`);
      process.exit(1);
    }
  }

  return options;
}

// Main execution
if (require.main === module) {
  const options = parseArgs();
  cleanupData(options).catch(error => {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  });
}

export { cleanupData, DATA_FILES };
