#!/bin/bash
# Test script for multi-provider OAuth

# Load environment from .env.oauth
set -a
source .env.oauth
set +a

# Force OAuth mode
export MCP_DEV_SKIP_AUTH=false
export MCP_MODE=streamable_http

# Start server
echo "Starting MCP server with multi-provider OAuth..."
npx tsx src/index.ts
