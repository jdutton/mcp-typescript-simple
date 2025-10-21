#!/bin/sh
set -e

echo "Building workspace packages in dependency order..."

# Clean stale TypeScript build info files
echo "0/4: Cleaning stale build info..."
find packages -name "tsconfig.tsbuildinfo" -type f -delete 2>/dev/null || true

# Build base packages first (no dependencies on other workspaces)
echo "1/4: Building base packages (config, tools, tools-llm)..."
npm run build -w @mcp-typescript-simple/config --if-present
npm run build -w @mcp-typescript-simple/tools --if-present
npm run build -w @mcp-typescript-simple/tools-llm --if-present

# Build server package (depends on tools)
echo "2/4: Building server package..."
npm run build -w @mcp-typescript-simple/server --if-present

# Build dependent packages (depend on base packages)
echo "3/4: Building example packages (example-tools-basic, example-tools-llm)..."
npm run build -w @mcp-typescript-simple/example-tools-basic --if-present
npm run build -w @mcp-typescript-simple/example-tools-llm --if-present

echo "4/4: Complete"

echo "✓ All workspace packages built successfully"
