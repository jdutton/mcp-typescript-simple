#!/bin/bash
# Fix imports in persistence package files

set -e

PERSIST_DIR="packages/persistence/src"

echo "Fixing imports in persistence package..."

# Fix imports from auth/stores/XXX-store-interface.ts → ../../interfaces/XXX-store.ts
find "$PERSIST_DIR" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from './session-store-interface\.js'|from '../../interfaces/session-store.js'|g" \
  -e "s|from './oauth-token-store-interface\.js'|from '../../interfaces/oauth-token-store.js'|g" \
  -e "s|from './client-store-interface\.js'|from '../../interfaces/client-store.js'|g" \
  -e "s|from './token-store-interface\.js'|from '../../interfaces/token-store.js'|g" \
  -e "s|from './pkce-store-interface\.js'|from '../../interfaces/pkce-store.js'|g" \
  -e "s|from './mcp-session-metadata-store-interface\.js'|from '../../interfaces/mcp-metadata-store.js'|g" \
  {} \;

# Fix imports from ../providers/types.js → ../types.js
find "$PERSIST_DIR" -type f -name "*.ts" -exec sed -i '' \
  -e "s|from '../providers/types\.js'|from '../types.js'|g" \
  -e "s|from '../../auth/providers/types\.js'|from '../types.js'|g" \
  {} \;

# Fix imports from ../../observability/logger.js → (will need to come from main app)
# For now, we'll mark these for manual review by replacing with a placeholder comment

echo "Import fixes applied. Manual review needed for:"
grep -r "from '../../observability/logger.js'" "$PERSIST_DIR" || echo "No logger imports found (good!)"
grep -r "from '../../config/" "$PERSIST_DIR" || echo "No config imports found (good!)"

echo "Done!"
