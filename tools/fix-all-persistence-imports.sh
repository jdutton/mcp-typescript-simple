#!/bin/bash
# Comprehensive import fix script for persistence package

set -e

PERSIST_DIR="packages/persistence/src"

echo "=== Fixing all imports in persistence package ==="

# Step 1: Fix imports in stores/memory/* files
echo "Fixing imports in memory stores..."
find "$PERSIST_DIR/stores/memory" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\./session-store-interface\.js'|from '../../interfaces/session-store.js'|g" \
  -e "s|from '\./oauth-token-store-interface\.js'|from '../../interfaces/oauth-token-store.js'|g" \
  -e "s|from '\./client-store-interface\.js'|from '../../interfaces/client-store.js'|g" \
  -e "s|from '\./token-store-interface\.js'|from '../../interfaces/token-store.js'|g" \
  -e "s|from '\./pkce-store-interface\.js'|from '../../interfaces/pkce-store.js'|g" \
  -e "s|from '\.\./\.\./session/mcp-session-metadata-store-interface\.js'|from '../../interfaces/mcp-metadata-store.js'|g" \
  {} \;

# Step 2: Fix imports in stores/file/* files
echo "Fixing imports in file stores..."
find "$PERSIST_DIR/stores/file" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\./oauth-token-store-interface\.js'|from '../../interfaces/oauth-token-store.js'|g" \
  -e "s|from '\./client-store-interface\.js'|from '../../interfaces/client-store.js'|g" \
  -e "s|from '\./token-store-interface\.js'|from '../../interfaces/token-store.js'|g" \
  -e "s|from '\.\./\.\./session/mcp-session-metadata-store-interface\.js'|from '../../interfaces/mcp-metadata-store.js'|g" \
  {} \;

# Step 3: Fix imports in stores/redis/* files
echo "Fixing imports in redis stores..."
find "$PERSIST_DIR/stores/redis" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\./session-store-interface\.js'|from '../../interfaces/session-store.js'|g" \
  -e "s|from '\./oauth-token-store-interface\.js'|from '../../interfaces/oauth-token-store.js'|g" \
  -e "s|from '\./client-store-interface\.js'|from '../../interfaces/client-store.js'|g" \
  -e "s|from '\./token-store-interface\.js'|from '../../interfaces/token-store.js'|g" \
  -e "s|from '\./pkce-store-interface\.js'|from '../../interfaces/pkce-store.js'|g" \
  -e "s|from '\.\./\.\./session/mcp-session-metadata-store-interface\.js'|from '../../interfaces/mcp-metadata-store.js'|g" \
  {} \;

# Step 4: Fix imports in factories/* files
echo "Fixing imports in factories..."
find "$PERSIST_DIR/factories" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\./stores/session-store-interface\.js'|from '../interfaces/session-store.js'|g" \
  -e "s|from '\./stores/oauth-token-store-interface\.js'|from '../interfaces/oauth-token-store.js'|g" \
  -e "s|from '\./stores/client-store-interface\.js'|from '../interfaces/client-store.js'|g" \
  -e "s|from '\./stores/token-store-interface\.js'|from '../interfaces/token-store.js'|g" \
  -e "s|from '\./stores/pkce-store-interface\.js'|from '../interfaces/pkce-store.js'|g" \
  -e "s|from '\./stores/memory-session-store\.js'|from '../stores/memory/memory-session-store.js'|g" \
  -e "s|from '\./stores/memory-oauth-token-store\.js'|from '../stores/memory/memory-oauth-token-store.js'|g" \
  -e "s|from '\./stores/memory-client-store\.js'|from '../stores/memory/memory-client-store.js'|g" \
  -e "s|from '\./stores/memory-token-store\.js'|from '../stores/memory/memory-token-store.js'|g" \
  -e "s|from '\./stores/memory-pkce-store\.js'|from '../stores/memory/memory-pkce-store.js'|g" \
  -e "s|from '\./stores/file-oauth-token-store\.js'|from '../stores/file/file-oauth-token-store.js'|g" \
  -e "s|from '\./stores/file-client-store\.js'|from '../stores/file/file-client-store.js'|g" \
  -e "s|from '\./stores/file-token-store\.js'|from '../stores/file/file-token-store.js'|g" \
  -e "s|from '\./stores/redis-session-store\.js'|from '../stores/redis/redis-session-store.js'|g" \
  -e "s|from '\./stores/redis-oauth-token-store\.js'|from '../stores/redis/redis-oauth-token-store.js'|g" \
  -e "s|from '\./stores/redis-client-store\.js'|from '../stores/redis/redis-client-store.js'|g" \
  -e "s|from '\./stores/redis-token-store\.js'|from '../stores/redis/redis-token-store.js'|g" \
  -e "s|from '\./stores/redis-pkce-store\.js'|from '../stores/redis/redis-pkce-store.js'|g" \
  -e "s|from '\.\./session/mcp-session-metadata-store-interface\.js'|from '../interfaces/mcp-metadata-store.js'|g" \
  -e "s|from '\.\./session/memory-mcp-metadata-store\.js'|from '../stores/memory/memory-mcp-metadata-store.js'|g" \
  -e "s|from '\.\./session/file-mcp-metadata-store\.js'|from '../stores/file/file-mcp-metadata-store.js'|g" \
  -e "s|from '\.\./session/redis-mcp-metadata-store\.js'|from '../stores/redis/redis-mcp-metadata-store.js'|g" \
  {} \;

# Step 5: Fix imports in decorators/* files
echo "Fixing imports in decorators..."
find "$PERSIST_DIR/decorators" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\.\./session/mcp-session-metadata-store-interface\.js'|from '../interfaces/mcp-metadata-store.js'|g" \
  -e "s|from '\./mcp-session-metadata-store-interface\.js'|from '../interfaces/mcp-metadata-store.js'|g" \
  {} \;

# Step 6: Fix any remaining config imports to use @mcp-typescript-simple/config
echo "Fixing config imports to use workspace package..."
find "$PERSIST_DIR" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '\.\./\.\./config/environment\.js'|from '@mcp-typescript-simple/config'|g" \
  -e "s|from '\.\./config/environment\.js'|from '@mcp-typescript-simple/config'|g" \
  {} \;

echo "=== Import fixes complete! ==="
echo ""
echo "Checking for any remaining problematic imports..."
echo ""

# Show any remaining imports that might need manual review
echo "Remaining relative imports (should only be within package):"
grep -r "from '\.\." "$PERSIST_DIR" --include="*.ts" | grep -v "from '\.\./interfaces" | grep -v "from '\.\./stores" | grep -v "from '\.\./logger" | grep -v "from '\.\./types" | grep -v "from '\.\./utils" | grep -v "from '\.\./factories" || echo "  None found - good!"

echo ""
echo "Done!"
