#!/usr/bin/env node
/**
 * Cross-platform workspace build script
 * Builds npm workspace packages in dependency order
 *
 * Replaces tools/build-workspaces.sh for Windows compatibility
 */

import { execSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');

/**
 * Execute npm command and log output
 */
function exec(command, options = {}) {
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: rootDir,
      ...options,
    });
  } catch (error) {
    console.error(`Error executing: ${command}`);
    throw error;
  }
}

/**
 * Clean stale TypeScript build info files
 */
function cleanBuildInfo() {
  console.log('0/9: Cleaning stale build info...');
  const packagesDir = join(rootDir, 'packages');

  try {
    const packages = readdirSync(packagesDir, { withFileTypes: true });

    for (const pkg of packages) {
      if (pkg.isDirectory()) {
        const buildInfoPath = join(packagesDir, pkg.name, 'tsconfig.tsbuildinfo');
        try {
          unlinkSync(buildInfoPath);
        } catch {
          // File doesn't exist or already deleted - ignore
        }
      }
    }
  } catch (error) {
    // packages directory doesn't exist - ignore
  }
}

/**
 * Build workspace packages in dependency order
 */
function buildWorkspaces() {
  console.log('Building workspace packages in dependency order...');

  // Clean build info
  cleanBuildInfo();

  // Build observability first (no dependencies on other workspaces)
  console.log('1/9: Building observability package...');
  exec('npm run build -w @mcp-typescript-simple/observability --if-present');

  // Build base packages that depend on observability or have no workspace dependencies
  console.log('2/9: Building base packages (config, persistence, testing, tools, tools-llm)...');
  exec('npm run build -w @mcp-typescript-simple/config --if-present');
  exec('npm run build -w @mcp-typescript-simple/persistence --if-present');
  exec('npm run build -w @mcp-typescript-simple/testing --if-present');
  exec('npm run build -w @mcp-typescript-simple/tools --if-present');
  exec('npm run build -w @mcp-typescript-simple/tools-llm --if-present');

  // Build auth package (depends on config, persistence)
  console.log('3/9: Building auth package...');
  exec('npm run build -w @mcp-typescript-simple/auth --if-present');

  // Build server package (depends on tools)
  console.log('4/9: Building server package...');
  exec('npm run build -w @mcp-typescript-simple/server --if-present');

  // Build example packages (depend on base packages + server)
  console.log('5/9: Building example packages (example-tools-basic, example-tools-llm)...');
  exec('npm run build -w @mcp-typescript-simple/example-tools-basic --if-present');
  exec('npm run build -w @mcp-typescript-simple/example-tools-llm --if-present');

  // Build http-server package (depends on auth, config, observability, persistence, server, example packages)
  console.log('6/9: Building http-server package...');
  exec('npm run build -w @mcp-typescript-simple/http-server --if-present');

  // Build example-mcp package (depends on all framework packages)
  console.log('7/9: Building example-mcp package...');
  exec('npm run build -w @mcp-typescript-simple/example-mcp --if-present');

  // Build adapter-vercel package (depends on all other packages)
  console.log('8/9: Building adapter-vercel package...');
  exec('npm run build -w @mcp-typescript-simple/adapter-vercel --if-present');

  console.log('9/9: Complete');
  console.log('✓ All workspace packages built successfully');
}

// Run the build
try {
  buildWorkspaces();
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
