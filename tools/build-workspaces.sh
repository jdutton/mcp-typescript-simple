#!/bin/sh
set -e

echo "Building workspace packages in dependency order..."

# Clean stale TypeScript build info files
echo "0/8: Cleaning stale build info..."
find packages -name "tsconfig.tsbuildinfo" -type f -delete 2>/dev/null || true

# Build base packages first (no dependencies on other workspaces)
echo "1/8: Building base packages (config, observability, persistence, testing, tools, tools-llm)..."
npm run build -w @mcp-typescript-simple/config --if-present
npm run build -w @mcp-typescript-simple/observability --if-present
npm run build -w @mcp-typescript-simple/persistence --if-present
npm run build -w @mcp-typescript-simple/testing --if-present
npm run build -w @mcp-typescript-simple/tools --if-present
npm run build -w @mcp-typescript-simple/tools-llm --if-present

# Build auth package (depends on config, persistence)
echo "2/8: Building auth package..."
npm run build -w @mcp-typescript-simple/auth --if-present

# Build server package (depends on tools)
echo "3/8: Building server package..."
npm run build -w @mcp-typescript-simple/server --if-present

# Build example packages (depend on base packages + server)
echo "4/8: Building example packages (example-tools-basic, example-tools-llm)..."
npm run build -w @mcp-typescript-simple/example-tools-basic --if-present
npm run build -w @mcp-typescript-simple/example-tools-llm --if-present

# Build http-server package (depends on auth, config, observability, persistence, server, example packages)
echo "5/8: Building http-server package..."
npm run build -w @mcp-typescript-simple/http-server --if-present

# Build adapter-vercel package (depends on all other packages)
echo "6/8: Building adapter-vercel package..."
npm run build -w @mcp-typescript-simple/adapter-vercel --if-present

echo "7/8: Complete"

echo "✓ All workspace packages built successfully"
