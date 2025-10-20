#!/bin/bash
set -e

echo "Building workspace packages in dependency order..."

# Clean stale TypeScript build info files
echo "0/2: Cleaning stale build info..."
find packages -name "tsconfig.tsbuildinfo" -type f -delete 2>/dev/null || true

# Build base packages first (no dependencies on other workspaces)
echo "1/2: Building base packages (tools, tools-llm)..."
npm run build -w @mcp-typescript-simple/tools --if-present
npm run build -w @mcp-typescript-simple/tools-llm --if-present

# Build dependent packages (depend on base packages)
echo "2/2: Building dependent packages (example-tools-basic, example-tools-llm)..."
npm run build -w @mcp-typescript-simple/example-tools-basic --if-present
npm run build -w @mcp-typescript-simple/example-tools-llm --if-present

echo "✓ All workspace packages built successfully"
