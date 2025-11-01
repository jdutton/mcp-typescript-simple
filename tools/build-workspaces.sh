#!/bin/sh
set -e

echo "Building workspace packages in dependency order..."

# Clean stale TypeScript build info files
echo "0/9: Cleaning stale build info..."
find packages -name "tsconfig.tsbuildinfo" -type f -delete 2>/dev/null || true

# Build observability first (no dependencies on other workspaces)
echo "1/9: Building observability package..."
npm run build -w @mcp-typescript-simple/observability --if-present

# Build base packages that depend on observability or have no workspace dependencies
echo "2/9: Building base packages (config, persistence, testing, tools, tools-llm)..."
npm run build -w @mcp-typescript-simple/config --if-present
npm run build -w @mcp-typescript-simple/persistence --if-present
npm run build -w @mcp-typescript-simple/testing --if-present
npm run build -w @mcp-typescript-simple/tools --if-present
npm run build -w @mcp-typescript-simple/tools-llm --if-present

# Build auth package (depends on config, persistence)
echo "3/9: Building auth package..."
npm run build -w @mcp-typescript-simple/auth --if-present

# Build server package (depends on tools)
echo "4/9: Building server package..."
npm run build -w @mcp-typescript-simple/server --if-present

# Build example packages (depend on base packages + server)
echo "5/9: Building example packages (example-tools-basic, example-tools-llm)..."
npm run build -w @mcp-typescript-simple/example-tools-basic --if-present
npm run build -w @mcp-typescript-simple/example-tools-llm --if-present

# Build http-server package (depends on auth, config, observability, persistence, server, example packages)
echo "6/9: Building http-server package..."
npm run build -w @mcp-typescript-simple/http-server --if-present

# Build example-mcp package (depends on all framework packages)
echo "7/9: Building example-mcp package..."
npm run build -w @mcp-typescript-simple/example-mcp --if-present

# Build adapter-vercel package (depends on all other packages)
echo "8/9: Building adapter-vercel package..."
npm run build -w @mcp-typescript-simple/adapter-vercel --if-present

echo "9/9: Complete"

echo "✓ All workspace packages built successfully"
